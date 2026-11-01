import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.services.tts import EmptySpeech, SpeechBusy, SpeechUnavailable, speak_text

router = APIRouter()


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator('text')
    @classmethod
    def validate_text(cls, text: str) -> str:
        if not text.strip() or '\x00' in text:
            raise ValueError('Text must contain speech and no null characters.')
        return text.strip()


class SpeakResponse(BaseModel):
    status: str


@router.post('/api/v1/speak', response_model=SpeakResponse)
async def speak(request: SpeakRequest):
    try:
        await run_in_threadpool(speak_text, request.text)
    except EmptySpeech:
        raise HTTPException(422, 'Text contains no speakable content after emoji removal.') from None
    except SpeechUnavailable:
        raise HTTPException(501, 'Local speech playback requires macOS.') from None
    except SpeechBusy:
        raise HTTPException(409, 'Speech playback is already in progress.') from None
    except subprocess.TimeoutExpired:
        raise HTTPException(504, 'Speech playback timed out.') from None
    except (OSError, subprocess.SubprocessError):
        raise HTTPException(503, 'Local speech playback failed.') from None
    return SpeakResponse(status='completed')
