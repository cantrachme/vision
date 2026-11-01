
from fastapi import FastAPI

app = FastAPI(
    title="VISION API",
    description="Backend for the VISION AI Desktop Assistant",
    version="0.1.0",
)


@app.get("/")
async def root():
    return {
        "message": "VISION backend is running",
        "version": "0.1.0",
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "vision-backend",
    }
