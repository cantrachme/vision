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
