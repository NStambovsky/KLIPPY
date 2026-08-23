from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api import router
from src.settings import CLIPS_DIR, STATIC_DIR, UPLOADS_DIR


app = FastAPI(title="Klippy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for path in (UPLOADS_DIR, CLIPS_DIR, STATIC_DIR):
    path.mkdir(parents=True, exist_ok=True)

app.include_router(router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
