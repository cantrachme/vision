"""Local macOS speech playback, without shell interpretation."""
import platform
import subprocess
from threading import Lock

_lock = Lock()


class SpeechUnavailable(Exception):
    pass


class SpeechBusy(Exception):
    pass


def speak_text(text: str) -> None:
    if platform.system() != 'Darwin':
        raise SpeechUnavailable()
    # Reject overlap instead of queuing an unbounded number of utterances.
    if not _lock.acquire(blocking=False):
        raise SpeechBusy()
    try:
        # stdin keeps user text out of both option parsing and process arguments.
        subprocess.run(['/usr/bin/say'], input=text, text=True, shell=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=60)
    finally:
        _lock.release()
