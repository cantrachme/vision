
# VISION

VISION is a voice-first AI desktop assistant designed for macOS and Windows.

## Technology Stack

- Backend: Python 3.11 + FastAPI
- Desktop: Tauri + React + TypeScript (planned)
- AI: Cloud LLM with local tool execution (planned)
- Voice: Local speech recognition and text-to-speech (planned)
- Database: SQLite (planned)

## Backend Setup

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Run Backend

```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## API Documentation

http://127.0.0.1:8000/docs
