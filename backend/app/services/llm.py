
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
)

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

SYSTEM_PROMPT = """
You are VISION, a personal AI desktop assistant.

Your responsibilities:
- Understand natural-language requests.
- Respond clearly and concisely.
- Help users operate their computers.
- Explain what you can and cannot do.
- Never claim to have performed an action unless
  a connected tool confirms it.

You currently have no desktop control tools.
"""


async def generate_response(message: str) -> str:
    response = await client.responses.create(
        model=MODEL,
        instructions=SYSTEM_PROMPT,
        input=message,
        max_output_tokens=300,
    )

    return response.output_text
