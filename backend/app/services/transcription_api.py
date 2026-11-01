from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.services.speech import AUDIO_TYPES, MAX_AUDIO_BYTES, transcribe_audio

router = APIRouter()


class TranscriptionResponse(BaseModel):
    text: str


@router.post('/api/v1/transcribe', response_model=TranscriptionResponse)
async def transcribe(file: UploadFile = File(...)):
    try:
        suffix = Path(file.filename or '').suffix.lower()
        if suffix not in AUDIO_TYPES or file.content_type not in AUDIO_TYPES[suffix] | {'application/octet-stream'}:
            raise HTTPException(415, 'Upload a WAV or MP3 audio file.')
        data = await file.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, 'Audio file exceeds the 10 MiB limit.')
        if not data:
            raise HTTPException(400, 'Audio file is empty.')
        try:
            text = await run_in_threadpool(transcribe_audio, data)
        except Exception:
            # Decoder/model exceptions may include paths or sensitive audio metadata.
            raise HTTPException(503, 'Audio transcription failed. Verify the audio file and local speech model.') from None
        return TranscriptionResponse(text=text)
    finally:
        await file.close()
