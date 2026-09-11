// Locally, requests go to /api/* and Vite's dev server proxy (vite.config.js)
// forwards them to the backend on :8000. In production there is no dev
// server, so VITE_API_URL must be set at build time to the deployed
// backend's full origin (e.g. https://chicago-crime-backend.onrender.com) —
// see README.md's Deployment section.
export const API_BASE = import.meta.env.VITE_API_URL || '/api'
