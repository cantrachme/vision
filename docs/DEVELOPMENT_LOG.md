# VISION development log

## Project and architecture
VISION is a voice-first desktop AI assistant for macOS and Windows. The current backend uses Python 3.11 and FastAPI. Tauri, React, TypeScript, local speech recognition, speech output, SQLite, and desktop tool execution are planned.

## Relevant structure and implemented features
- `backend/app/main.py`: FastAPI application, request validation, root and health endpoints, and `POST /api/v1/chat`.
- `backend/app/services/llm.py`: loads environment configuration and selects local Ollama by default or the asynchronous OpenAI Responses API. Sends a system instruction and user message, limits output to 300 tokens, and returns response text. No desktop tools are connected.
- `backend/requirements.txt`: backend installation dependencies.
- Root `requirements.txt`: existing alternative dependency snapshot, including OpenAI.
- `backend/tests/test_chat.py`: focused offline regression tests.

## Task 01 — OpenAI integration (2026-11-01)
### Findings and decisions
The backend requirements omitted OpenAI even though application imports require it. Added `openai==3.42.0`, matching the already installed version and root dependency snapshot. This fixes clean backend installations; it does not explain a running server's 502.

The running environment has the SDK installed and backend credentials configured. A single diagnostic provider request, with retries disabled, failed with `APIConnectionError` caused by `ConnectError`, before an HTTP response. Certificate verification failure was not indicated. The execution environment restricts networking, so this result cannot establish the original server's failure cause. No further provider requests were made. Authentication, quota, model access, and original host connectivity remain unverified.

Kept existing application behavior and endpoints unchanged. Existing local changes in the chat implementation were preserved. No secrets were printed, modified, or documented.

### Files changed
- `backend/requirements.txt`: declares the required SDK.
- `backend/tests/test_chat.py`: adds mocked provider success, sanitized 502 handling, and existing endpoint checks.
- `docs/DEVELOPMENT_LOG.md`: creates this cumulative project reference.

### Validation
`PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -v`: 3 tests passed. Tests call route functions directly and mock provider calls; they do not test HTTP transport or real provider availability.

### Pending work and limitations
The original 502 remains unresolved pending sanitized provider failure status/category or connectivity evidence from the actual server environment. Avoid changing credentials, model selection, or TLS verification without evidence. Voice, desktop UI, persistence, and tool execution remain planned.

## Task 02 — Safe live-failure diagnostics (2026-11-01)
- Updated `backend/app/main.py` to emit a JSON error event with exception type, HTTP status, and an allowlisted provider error code. Unknown codes become `unrecognized`; missing fields become null. Exception messages, tracebacks, bodies, headers, and user content are excluded. Client-facing 502 text is unchanged.
- Expanded `backend/tests/test_chat.py`: five tests passed, including ASGI HTTP checks for root, health, chat success, and invalid input, plus structured logging and sensitive-content exclusion.
- External networking is restricted in this execution environment. No live request was attempted in Task 02. The original provider failure remains unconfirmed; Task 01's connection failure does not establish the local server's cause.
- Local diagnostic: from the project root, run the following command. It invokes the chat handler once using the configured model and credentials, disables SDK retries, prints only safe logs/status, and suppresses response content and tracebacks. It may incur one API request.

```bash
cd /Users/rachit/Downloads/Projects/vision/backend && .venv/bin/python -c 'import asyncio, logging; from fastapi import HTTPException; from app.main import chat, ChatRequest; from app.services import llm; logging.basicConfig(level=logging.ERROR); llm.client = llm.client.with_options(max_retries=0, timeout=20); exec("async def check():\n try:\n  await chat(ChatRequest(message=\"Reply OK\"))\n  print(\"Provider request succeeded\")\n except HTTPException as exc:\n  print(\"Chat HTTP status:\", exc.status_code)"); asyncio.run(check())'
```


## Task 03 — Local Ollama provider (2026-11-01)
- `backend/app/services/llm.py`: selects `LLM_PROVIDER=ollama` by default, with `OLLAMA_MODEL=qwen3:4b` and `OLLAMA_BASE_URL=http://127.0.0.1:11434`. Uses native `/api/chat`, non-streaming responses, a 300-token output limit, and `think:false` ([official API reference](https://github.com/ollama/ollama/blob/main/docs/api.md)). Thinking control depends on server/model support.
- OpenAI is constructed only when selected, so local mode requires no API key. OpenAI uses a 60-second timeout and no retries. Ollama uses a 5-second connection timeout and 120-second operation timeout; environment proxies are bypassed for local requests. No automatic provider fallback or retry is performed.
- Environment loading now targets `backend/.env` consistently across working directories, preserving inherited environment overrides. `.env` was not changed. `backend/.env.example` documents provider selection and optional cloud configuration.
- `backend/app/main.py`: preserves endpoint schemas and sanitized 502 errors; safe structured logging now also handles local connection, timeout, HTTP, configuration, and malformed-response failures.
- `backend/requirements.txt`: explicitly declares already installed `httpx2==2.16.0`, also used by the OpenAI SDK.
- `backend/tests/test_chat.py`: eight focused tests passed, covering local default without credentials, local request settings, OpenAI dispatch, configuration errors, sanitized failures, and existing HTTP endpoints.
- One real request through the application's ASGI `/api/v1/chat` route attempted local Ollama and returned 502 with `ConnectError`; no provider HTTP response was received. Localhost access from this environment remains unavailable; this does not establish that the user's Ollama service is down.
- With the updated backend running locally, verify once using:
  `curl --max-time 130 -sS http://127.0.0.1:8000/api/v1/chat -H 'Content-Type: application/json' -d '{"message":"Reply with OK only."}'`
- Limitations: health reports application liveness only; model installation and Ollama availability are managed externally. Requests remain single-turn. OpenAI package remains an installation dependency, but its credentials and service are optional.

## Task 04 — Final-answer-only Qwen3 output (2026-11-01)
- Root cause in application handling: Ollama's `message.content` was returned verbatim. The reported inline reasoning and closing tag therefore reached clients despite `think:false`. The precise local server/template reason for ignoring or failing to separate thinking is unverified.
- `backend/app/services/llm.py`: retains native `think:false` and reads only `message.content`, never `message.thinking`. Adds Qwen3's `/no_think` system instruction for compatibility. A small Ollama-only fallback takes text after the last `</think>` (including when the opening tag is absent), discards unfinished `<think>` tails, and trims whitespace. Empty final answers raise the existing sanitized provider error rather than returning reasoning. OpenAI behavior and endpoint schemas remain unchanged.
- Controls follow [Ollama thinking fields](https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx) and [Qwen's /no_think guidance](https://qwen.readthedocs.io/en/stable/inference/transformers.html).
- `backend/tests/test_chat.py`: nine tests passed, with eight regression cases covering structured thinking, complete and missing-opening tags, empty thinking, plain answers, unfinished reasoning, and missing final answers. Existing OpenAI and endpoint checks still pass. No live API requests were made.
- Limitation: fallback recognizes explicit lowercase Qwen tags; unmarked reasoning cannot be reliably distinguished from an answer. Literal think tags in requested answer content may be treated as reasoning delimiters. Local template behavior remains unverified; no model/server changes were made.

## Task 05 — Verified integration release (2026-11-01)
- User confirmed local `POST /api/v1/chat` returned `{"response":"OK"}` using Ollama and Qwen3 4B. Local final-answer verification is now successful; the earlier environment connection failure is not a local deployment blocker. OpenAI's original live failure remains unconfirmed.
- Re-ran the focused suite: all nine tests passed. Reviewed the six changed integration files; no unexpected files or pre-staged changes were present. Only source, tests, example configuration, dependencies, and this log are included. Secrets, virtual environments, models, and generated artifacts are excluded.

## Task 06 — In-process conversation sessions (2026-11-01)
- `backend/app/main.py`: accepts optional UUID `session_id`; message-only requests still work. Successful responses now contain `response` and `session_id`. Missing IDs are generated; unknown valid IDs start empty conversations. Invalid IDs return 422. Reuse the returned ID to continue.
- Stores the latest 10 successful user/assistant exchanges (20 messages) per session. A per-session asyncio lock covers history reading, generation, and appending, preventing overlapping requests from losing context. Different sessions use independent locks. Failed/cancelled requests append no turns; existing sanitized errors and root/health endpoints are preserved.
- `backend/app/services/llm.py`: sends recent history followed by the current message to both Ollama and OpenAI, keeping system instructions separate. Rejects empty OpenAI answers before recording a turn. Qwen cleaning remains unchanged.
- Updated `backend/tests/test_chat.py` for the additive response field and OpenAI message input; added `backend/tests/test_sessions.py` for creation, follow-up context, isolation, limits, invalid IDs, failure rollback, concurrent ordering, legacy requests, and both provider payloads.
- Validation: all 14 focused tests passed using mocked providers; `git diff --check` passed. No live calls, new dependencies, commits, or pushes.
- Limitations: memory and locks live in one application process/event loop, disappear on restart, and are not shared across workers. Session count has no expiry/global cap (including empty sessions after failures). UUIDs identify conversations but provide no authentication. The 10-exchange limit bounds turn count, not exact token count; callers should retain their session IDs.

## Task 07 — Select the non-thinking Qwen3 checkpoint (2026-11-01)
- Registry evidence: [qwen3:4b](https://ollama.com/library/qwen3:4b) and [qwen3:4b-thinking](https://ollama.com/library/qwen3:4b-thinking) currently share digest `359d7dd4bcda`; [qwen3:4b-instruct](https://ollama.com/library/qwen3:4b-instruct) uses `0edcdef34593`. This supports a model-selection cause: requesting the generic tag can select a thinking checkpoint, so prompt-level controls alone are insufficient. The locally installed digest/template could not be inspected because `/api/show` failed with ConnectError; the exact local cause remains unconfirmed.
- `backend/app/services/llm.py`: defaults to `qwen3:4b-instruct` and maps the old exact `qwen3:4b` setting to it, including existing environment configuration without editing `.env`. Other model overrides remain unchanged. Retains native `think:false`, Qwen `/no_think`, and structured `message.content` selection, never including `message.thinking`. Existing tagged fallback remains; no heuristics remove untagged prose. Length-limited generations now fail safely instead of saving incomplete output as a successful turn.
- Verified controls and fields against [Ollama's thinking documentation](https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx). History already consists of ordered user/assistant role messages with a separate system message; no formatting defect was found or changed. Previously leaked assistant text can remain in existing sessions and influence subsequent generations: restart the backend or begin a new session after changing models.
- `backend/.env.example`: documents the instruct default and installation command. `backend/tests/test_chat.py`: checks default/legacy model selection, custom override preservation, and rejection of length-limited output. All 15 backend tests passed, including session history/concurrency, OpenAI, structured-thinking separation, and endpoint checks; diff whitespace checks passed.
- No real local generation was verified: metadata access failed before inference. Required local setup: `ollama pull qwen3:4b-instruct`, restart the backend, then test with a new session. The model is not downloaded automatically. Unsupported/custom thinking models can still emit untagged reasoning; it cannot be safely separated by text processing. No commits or pushes.

## Task 08 — Verified conversation memory release (2026-11-02)
- User confirmed `qwen3:4b-instruct` is installed and responding locally. Follow-up returned `Python`, retained the same session ID, and showed no reasoning leakage. This verifies the current model and session behavior locally, beyond mocked tests.
- Re-ran all 15 backend tests successfully; diff whitespace checks passed. Reviewed the six relevant changed files, with no unexpected or previously staged changes. Release includes only backend source, tests, example configuration, and this log; excludes secrets, `.env`, virtual environments, models, and generated artifacts.
- Existing limitations remain: process-local memory without session expiry/global cap, no cross-worker sharing or session authentication, and unverified live OpenAI operation. Local instruct-model verification supersedes Task 07's pending local setup/testing action.

## Task 09 — Local speech-to-text (2026-11-02)
- Added `backend/app/services/speech.py`: lazily imports faster-whisper and initializes the multilingual `base` model once per process, configurable with `WHISPER_MODEL` (name or converted local directory). Uses CPU/int8 and four CPU threads, following [faster-whisper CPU guidance](https://github.com/SYSTRAN/faster-whisper). A thread lock serializes initialization/inference; segment generators are fully consumed in the worker. Audio is passed in memory, never explicitly saved or logged.
- Added `backend/app/services/transcription_api.py`, registered in `backend/app/main.py`: multipart `POST /api/v1/transcribe`, field `file`, returns `{"text":"..."}`. Accepts WAV/MP3 extensions and matching MIME types (or generic binary). Reads at most 10 MiB plus one byte; rejects unsupported types (415), empty uploads (400), oversized files (413), and missing files (422). Decoder/model failures return sanitized 503. File handles close on all paths. Actual format decoding is delegated to faster-whisper/PyAV; extension/MIME validation alone does not prove valid audio. Thread-pool execution keeps decoding and recognition off the event loop.
- Updated backend dependencies with faster-whisper and python-multipart; `.env.example` documents `WHISPER_MODEL=base`. Added optional microphone dependencies in `backend/scripts/requirements.txt` and manual `record_and_transcribe.py`: explicitly records five seconds, builds mono 16 kHz WAV in memory, submits to localhost, and prints transcript. No microphone recording occurs automatically.
- Added `backend/tests/test_speech.py`: mock WAV/MP3 uploads, validation, sanitized failure, worker execution, lazy model reuse under concurrent calls, and generator consumption. All 18 backend tests passed without model downloads; diff checks passed. Installed only python-multipart for endpoint testing; actual faster-whisper inference and microphone hardware remain unverified.
- Local verification: from `backend`, run `.venv/bin/python -m pip install -r requirements.txt -r scripts/requirements.txt`, start `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`, then in another terminal run `.venv/bin/python scripts/record_and_transcribe.py`. Allow macOS microphone access. First transcription downloads model weights; cache/provision them before offline operation. An existing file can be tested with `curl -sS http://127.0.0.1:8000/api/v1/transcribe -F 'file=@/absolute/path/clip.wav;type=audio/wav'`.
- Limitations: no Apple GPU acceleration, transcription deadline, decoded-duration limit, global upload cap, or persistent job queue. File-size checks occur after multipart parsing/spooling; use a server/proxy request-size limit for untrusted deployment. Compressed audio can be long despite small size. Requests serialize per model, and first use can be slow. Silence may produce empty text. No cloud speech, frontend, wake word, or speech synthesis was added. Existing chat/session behavior is unchanged. No commits or pushes.

## Task 10 — Verified speech-to-text release (2026-11-02)
- User confirmed local microphone recording and faster-whisper transcription succeeded, with minor recognition errors. Exact misrecognized words were not supplied; recognition accuracy remains a known limitation, rather than a verified exact-match result. This supersedes Task 09's pending hardware/inference verification.
- Re-ran all 18 backend tests successfully and passed diff whitespace checks. Reviewed only speech-related source, tests, example configuration, dependency files, and documentation for release. No secrets, `.env`, virtual environments, audio recordings, or downloaded weights are included.

## Task 11 — Local macOS text-to-speech (2026-11-02)
- Added `backend/app/services/tts.py`: invokes `/usr/bin/say` with a fixed argument list, `shell=False`, and user text on stdin (never interpreted as command options). Uses the system default voice/output, discards subprocess output, and enforces a 60-second timeout. Python kills/waits for timed-out subprocesses. A nonblocking process-local thread lock rejects overlapping speech rather than accumulating a queue; release occurs even on failure.
- Added `backend/app/services/tts_api.py`, registered in `backend/app/main.py`: `POST /api/v1/speak` accepts `{"text":"Hello"}` and returns `{"status":"completed"}` after playback finishes. Validates 1–2000 characters, rejects whitespace-only/null-containing input (422), and runs playback on the thread pool. Sanitized errors: unsupported OS (501), busy (409), timeout (504), missing command/subprocess failure (503). No subprocess details or speech text are logged.
- Added `backend/scripts/test_speak.py` for explicit local playback testing. With the backend running on your Mac, execute from the project root: `backend/.venv/bin/python backend/scripts/test_speak.py`. No dependency/model downloads are needed for TTS.
- Added `backend/tests/test_tts.py`: safe subprocess/stdin arguments, lock contention/release, validation, worker execution, unsupported platforms, timeout and sanitized failures. All 23 backend tests passed with mocked playback; whitespace diff checks passed. Existing chat/session/transcription tests pass. Real audible output was not verified in this environment; automated tests produce no speech.
- Limitations: macOS only; one speech operation per backend process (multiple workers/external programs can overlap). Playback uses the backend host's audio, not a remote caller's device. The response waits for completion; client disconnects do not explicitly cancel speech. Text exceeding the timeout is stopped. No voice selection, cloud services, frontend, wake word, or model downloads were added. No commits or pushes.

## Task 12 — Verified text-to-speech release (2026-11-02)
- User confirmed `/api/v1/speak` returned `completed` and speech was heard through Mac speakers. Standalone `/usr/bin/say` also played successfully. This completes the pending local audible-playback verification from Task 11.
- Re-ran all 23 backend tests successfully; diff whitespace checks passed. Reviewed the six TTS-related files for release. Only source, manual test script, automated tests, and documentation are included; no secrets, `.env`, virtual environments, or generated files are staged.
- Existing limitations remain: macOS/backend-host playback only, overlap protection per process, and no explicit cancellation on client disconnect.
