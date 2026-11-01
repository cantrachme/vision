import asyncio
import unittest
from uuid import UUID, uuid4
from unittest.mock import AsyncMock, patch

import httpx2 as httpx
from fastapi import HTTPException
from app.main import app, chat, ChatRequest, _sessions
from app.services import llm


class SessionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _sessions.clear()

    async def test_new_followup_and_isolation(self):
        mock = AsyncMock(return_value='Answer')
        with patch('app.main.generate_response', mock):
            first = await chat(ChatRequest(message='First'))
            self.assertIsInstance(first.session_id, UUID)
            await chat(ChatRequest(message='Next', session_id=first.session_id))
            self.assertEqual(mock.call_args.kwargs['history'], [
                {'role': 'user', 'content': 'First'},
                {'role': 'assistant', 'content': 'Answer'}])
            other = await chat(ChatRequest(message='Other'))
            self.assertNotEqual(first.session_id, other.session_id)
            self.assertEqual(mock.call_args.kwargs['history'], [])

    async def test_limit_and_failure(self):
        session = uuid4()
        with patch('app.main.generate_response', AsyncMock(return_value='Answer')) as mock:
            for i in range(12):
                await chat(ChatRequest(message=str(i), session_id=session))
            history = _sessions[session][1]
            self.assertEqual(len(history), 20)
            self.assertEqual(history[0]['content'], '2')
            self.assertEqual(len(mock.call_args.kwargs['history']), 20)
        before = list(history)
        with patch('app.main.generate_response', AsyncMock(side_effect=llm.ProviderError())):
            with self.assertLogs('app.main', level='ERROR'):
                with self.assertRaises(HTTPException):
                    await chat(ChatRequest(message='Failed', session_id=session))
        self.assertEqual(history, before)

    async def test_concurrent_requests_are_serialized(self):
        session = uuid4()
        entered = asyncio.Event()
        release = asyncio.Event()
        contexts = []
        async def generate(message, history):
            contexts.append(history)
            if message == 'First':
                entered.set()
                await release.wait()
            return 'Answer'
        with patch('app.main.generate_response', generate):
            first = asyncio.create_task(chat(ChatRequest(message='First', session_id=session)))
            await entered.wait()
            second = asyncio.create_task(chat(ChatRequest(message='Second', session_id=session)))
            await asyncio.sleep(0)
            self.assertEqual(len(contexts), 1)
            release.set()
            await asyncio.gather(first, second)
        self.assertEqual(contexts[1][0]['content'], 'First')

    async def test_invalid_session_and_legacy_request(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/chat', json={'message': 'Hi', 'session_id': 'invalid'})
            self.assertEqual(response.status_code, 422)
            with patch('app.main.generate_response', AsyncMock(return_value='Hello')):
                response = await client.post('/api/v1/chat', json={'message': 'Hi'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['response'], 'Hello')
            UUID(response.json()['session_id'])

    async def test_both_providers_receive_history(self):
        from types import SimpleNamespace
        history = [{'role': 'user', 'content': 'Earlier'},
                   {'role': 'assistant', 'content': 'Answer'}]
        expected = history + [{'role': 'user', 'content': 'Next'}]
        with patch.dict('os.environ', {'LLM_PROVIDER': 'openai', 'OPENAI_API_KEY': 'test-placeholder'}), patch.object(llm, 'AsyncOpenAI') as factory:
            create = AsyncMock(return_value=SimpleNamespace(output_text='Final'))
            factory.return_value.__aenter__.return_value.responses.create = create
            await llm.generate_response('Next', history=history)
            self.assertEqual(create.call_args.kwargs['input'], expected)
        real_client = httpx.AsyncClient
        def respond(request):
            import json
            self.assertEqual(json.loads(request.content)['messages'][1:], expected)
            return httpx.Response(200, json={'message': {'content': 'Final'}})
        with patch.dict('os.environ', {'LLM_PROVIDER': 'ollama'}), patch.object(
            llm.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(
                transport=httpx.MockTransport(respond), **kw)):
            await llm.generate_response('Next', history=history)
        self.assertEqual(len(history), 2)
