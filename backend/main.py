import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag_system import NarrativeChatbot, NarrativeRAGSystem

load_dotenv()

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

    answer, rag = state["chatbot"].ask(req.query, top_k=req.top_k)
    return {
        "answer": answer,
        "crime_chunks": rag["crime"],
        "news_chunks": rag["news"],
        "links": rag["links"],
    }
