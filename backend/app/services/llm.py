
import os

from pathlib import Path

import httpx2 as httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")


class ProviderError(Exception):
    """Safe provider failure marker; never contains upstream response content."""


SYSTEM_PROMPT = """
You are VISION, a personal AI desktop assistant.

Your responsibilities:
- Understand natural-language requests.
- Never generate emojis or decorative symbols.
- Respond in natural, concise, conversational language suitable for speaking aloud.
- Avoid unnecessary follow-up questions.
- Help users operate their computers.
- Explain what you can and cannot do.
- Never claim to have performed an action unless
  a connected tool confirms it.

You currently have no desktop control tools.
"""


def _final_ollama_answer(content: str) -> str:
    # Compatibility fallback for templates returning reasoning inside content.
    # A missing opening tag can occur when the template supplies it itself.
    if "</think>" in content:
        content = content.rsplit("</think>", 1)[1]
    if "<think>" in content:
        content = content.split("<think>", 1)[0]
    content = content.strip()
    if not content:
        raise ProviderError("invalid_response")
    return content


async def generate_response(message: str, history: list[dict[str, str]] | None = None) -> str:
    messages = [dict(turn) for turn in (history or [])[-20:]]
    messages.append({"role": "user", "content": message})
    provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if provider == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise ProviderError("missing_configuration")
        async with AsyncOpenAI(timeout=60.0, max_retries=0) as client:
            response = await client.responses.create(
                model=MODEL, instructions=SYSTEM_PROMPT,
                input=messages, max_output_tokens=300,
            )
            if not response.output_text.strip():
                raise ProviderError("invalid_response")
            return response.output_text
    if provider != "ollama":
        raise ProviderError("invalid_provider")

    model = os.getenv("OLLAMA_MODEL", "qwen3:4b-instruct").strip()
    # The registry's generic 4B tag aliases the thinking checkpoint.
    # Keep existing .env configurations usable with the non-thinking model.
    if model.lower() == "qwen3:4b":
        model = "qwen3:4b-instruct"
    system_prompt = SYSTEM_PROMPT + ("\n/no_think" if model.lower().startswith("qwen3:") else "")
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0),
                                 trust_env=False) as client:
        response = await client.post(
            os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/chat",
            json={
                "model": model,
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "stream": False, "think": False,
                "options": {"num_predict": 300},
            },
        )
        response.raise_for_status()
        try:
            payload = response.json()
            # A length-limited generation may contain no completed final answer.
            if payload.get("done_reason") == "length":
                raise ProviderError("incomplete_response")
            content = payload["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError()
            return _final_ollama_answer(content)
        except (ValueError, KeyError, TypeError):
            raise ProviderError("invalid_response") from None
