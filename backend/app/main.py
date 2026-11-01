import asyncio
from uuid import UUID, uuid4
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


# Accessed on the application event loop; no await between lookup and insertion.
_sessions: dict[UUID, tuple[asyncio.Lock, list[dict[str, str]]]] = {}


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    session_id: UUID | None = None


class ChatResponse(BaseModel):
    response: str
    session_id: UUID


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
        session_id = request.session_id or uuid4()
        lock, history = _sessions.setdefault(session_id, (asyncio.Lock(), []))
        async with lock:
            answer = await generate_response(request.message, history=[dict(turn) for turn in history])
            result = ChatResponse(response=answer, session_id=session_id)
            history.extend([{"role": "user", "content": request.message},
                            {"role": "assistant", "content": answer}])
            del history[:-20]
            return result

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
