"""Run manually: records five seconds from the default microphone."""
import io
import wave

import httpx2 as httpx
import sounddevice as sd


def record_audio():
    print('Recording for five seconds...')
    samples = sd.rec(5 * 16000, samplerate=16000, channels=1, dtype='int16')
    try:
        sd.wait()
    finally:
        sd.stop()
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(samples.tobytes())
    return audio.getvalue()


def main():
    audio = record_audio()
    try:
        response = httpx.post('http://127.0.0.1:8000/api/v1/transcribe',
                              files={'file': ('clip.wav', audio, 'audio/wav')},
                              timeout=180, trust_env=False)
        response.raise_for_status()
        print(response.json()['text'])
    except httpx.HTTPError:
        print('Transcription failed. Check the backend and local model setup.')


if __name__ == '__main__':
    main()
