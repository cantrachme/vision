import json
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAIError
import httpx2 as httpx

from app.services.llm import generate_response, ProviderError

logger = logging.getLogger(__name__)

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

    except (OpenAIError, httpx.HTTPError, ProviderError) as exc:
        # Provider messages, bodies, headers, and tracebacks may contain secrets.
        code = getattr(exc, "code", None)
        safe_code = code if isinstance(code, str) and code in {
            "invalid_api_key", "insufficient_quota", "rate_limit_exceeded",
            "model_not_found", "unsupported_parameter", "invalid_request_error",
            "context_length_exceeded", "server_error", "account_deactivated",
            "permission_denied", "billing_hard_limit_reached",
        } else ("unrecognized" if code is not None else None)
        logger.error(json.dumps({
            "event": "openai_request_failed" if isinstance(exc, OpenAIError) else "llm_request_failed",
            "exception_type": type(exc).__name__,
            "http_status": getattr(exc, "status_code", getattr(getattr(exc, "response", None), "status_code", None)),
            "provider_error_code": safe_code,
        }))
        raise HTTPException(
            status_code=502,
            detail="AI provider request failed. Check server logs.",
        )
