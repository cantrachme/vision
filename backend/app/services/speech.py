"""Local speech recognition. Model initialization and inference run in a worker."""
import io
import os
from threading import Lock

_model = None
_lock = Lock()
MAX_AUDIO_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = {'.wav': {'audio/wav', 'audio/x-wav', 'audio/wave'},
               '.mp3': {'audio/mpeg', 'audio/mp3'}}


def transcribe_audio(data: bytes) -> str:
    global _model
    # Serialize initialization and inference to bound model CPU/memory use.
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(os.getenv('WHISPER_MODEL', 'base'),
                                  device='cpu', compute_type='int8',
                                  cpu_threads=4)
        segments, _ = _model.transcribe(io.BytesIO(data), beam_size=1,
                                        condition_on_previous_text=False)
        return ' '.join(segment.text.strip() for segment in segments).strip()
