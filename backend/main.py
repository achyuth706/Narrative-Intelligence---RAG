import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.api_core import exceptions as google_errors
from pydantic import BaseModel

from rag_system import NarrativeChatbot, NarrativeRAGSystem

load_dotenv()
log = logging.getLogger("ccni")

API_KEY = os.getenv("GEMINI_API_KEY")

app = FastAPI(title="Chicago Crime Narrative Intelligence API")

# In production (Render), set FRONTEND_ORIGIN to the deployed frontend's URL.
origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if os.getenv("FRONTEND_ORIGIN"):
    origins.append(os.getenv("FRONTEND_ORIGIN"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = {"system": None, "chatbot": None, "error": None}


@app.on_event("startup")
def startup():
    try:
        system = NarrativeRAGSystem()
        state["system"] = system
        if API_KEY:
            state["chatbot"] = NarrativeChatbot(API_KEY, system)
        else:
            state["error"] = "GEMINI_API_KEY not set — /ask will fail until it is configured in backend/.env"
            print("WARNING:", state["error"])
    except FileNotFoundError as e:
        state["error"] = str(e)
        print("WARNING:", state["error"])


class AskRequest(BaseModel):
    query: str
    top_k: int = 5


@app.get("/health")
def health():
    return {
        "status": "ok" if state["system"] else "not_ready",
        "llm_configured": state["chatbot"] is not None,
        "error": state["error"],
    }


@app.get("/stats")
def stats():
    if not state["system"]:
        raise HTTPException(503, state["error"] or "System not ready")
    return state["system"].stats()


@app.get("/analytics")
def analytics():
    if not state["system"]:
        raise HTTPException(503, state["error"] or "System not ready")
    return state["system"].analytics()


@app.post("/ask")
def ask(req: AskRequest):
    if not req.query.strip():
        raise HTTPException(400, "query must not be empty")
    if not state["chatbot"]:
        raise HTTPException(503, state["error"] or "Chatbot not configured")

    # An unhandled exception here becomes a bare 500 from Starlette's outermost
    # error middleware, which sits *outside* CORSMiddleware — so it ships with
    # no CORS headers and the browser reports a misleading "blocked by CORS"
    # / "Failed to fetch". Raising HTTPException instead goes through CORS, so
    # the frontend receives and can display the real reason.
    try:
        answer, rag = state["chatbot"].ask(req.query, top_k=req.top_k)
    except google_errors.ResourceExhausted:
        log.warning("Gemini quota exhausted")
        raise HTTPException(
            429, "The Gemini API quota is used up for now (free tier is ~20 requests/day). Please try again later."
        )
    except (google_errors.PermissionDenied, google_errors.Unauthenticated) as e:
        log.error("Gemini rejected the API key: %s", e)
        raise HTTPException(
            502, "The server's Gemini API key was rejected (invalid, revoked, or flagged as leaked)."
        )
    except google_errors.GoogleAPICallError as e:
        log.exception("Gemini call failed")
        raise HTTPException(502, f"Answer generation failed upstream: {type(e).__name__}: {str(e)[:200]}")
    except Exception as e:
        log.exception("/ask failed")
        raise HTTPException(500, f"Answer generation failed: {type(e).__name__}")

    return {
        "answer": answer,
        "crime_chunks": rag["crime"],
        "news_chunks": rag["news"],
        "links": rag["links"],
    }
