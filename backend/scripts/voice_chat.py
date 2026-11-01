"""Explicit five-second voice turns over the local backend's HTTP API."""
import httpx2 as httpx

if __package__:
    from .record_and_transcribe import record_audio
else:
    from record_and_transcribe import record_audio


def main():
    session_id = None
    try:
        with httpx.Client(base_url='http://127.0.0.1:8000', timeout=180,
                          trust_env=False) as client:
            while True:
                choice = input('Enter to record, q to quit: ').strip().lower()
                if choice == 'q':
                    break
                if choice:
                    continue
                try:
                    audio = record_audio()
                except Exception:
                    print('Microphone recording failed. Check permissions and input device.')
                    continue
                stage = 'Transcription'
                try:
                    result = client.post('/api/v1/transcribe',
                        files={'file': ('clip.wav', audio, 'audio/wav')})
                    result.raise_for_status()
                    text = result.json()['text'].strip()
                    if not text:
                        print('No speech recognized. Try again.')
                        continue
                    print('You:', text)
                    stage = 'Chat'
                    payload = {'message': text}
                    if session_id:
                        payload['session_id'] = session_id
                    result = client.post('/api/v1/chat', json=payload)
                    result.raise_for_status()
                    answer = result.json()
                    session_id = answer['session_id']
                    print('VISION:', answer['response'])
                    stage = 'Speech playback'
                    result = client.post('/api/v1/speak', json={'text': answer['response']}, timeout=70)
                    result.raise_for_status()
                    if result.json()['status'] != 'completed':
                        print('Speech playback did not complete.')
                except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                    print(f'{stage} failed. Check the local backend and try another turn.')
    except (KeyboardInterrupt, EOFError):
        print('\nVoice chat ended.')


if __name__ == '__main__':
    main()
