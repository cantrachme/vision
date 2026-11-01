"""Manual test: run with the local backend active on your Mac."""
import httpx2 as httpx


def main():
    try:
        response = httpx.post('http://127.0.0.1:8000/api/v1/speak',
                              json={'text': 'Hello. VISION local speech is working.'},
                              timeout=70, trust_env=False)
        response.raise_for_status()
        print(response.json()['status'])
    except httpx.HTTPError:
        print('Speech request failed. Check the backend and macOS audio output.')


if __name__ == '__main__':
    main()
