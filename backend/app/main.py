
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAIError

from app.services.llm import generate_response

app = FastAPI(
    title="VISION API",
    description="Backend for the VISION AI Desktop Assistant",
    version="0.1.0",
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)


class ChatResponse(BaseModel):
    response: str


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


@app.post("/api/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        answer = await generate_response(request.message)
        return ChatResponse(response=answer)

    except OpenAIError:
        raise HTTPException(
            status_code=502,
            detail="AI provider request failed. Check server logs.",
        )
