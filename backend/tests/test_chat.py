import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from openai import APIConnectionError, APIStatusError
import httpx2 as httpx
from app.main import ChatRequest, chat, health, root
from app.services import llm


class ChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_request_and_response(self):
        create = AsyncMock(return_value=SimpleNamespace(output_text='Hello'))
        with patch.dict('os.environ', {'LLM_PROVIDER': 'openai', 'OPENAI_API_KEY': 'test-placeholder'}), patch.object(llm, 'AsyncOpenAI') as factory:
            factory.return_value.__aenter__.return_value.responses.create = create
            result = await chat(ChatRequest(message='Hi'))
        self.assertEqual(result.response, 'Hello')
        create.assert_awaited_once_with(
            model=llm.MODEL, instructions=llm.SYSTEM_PROMPT,
            input='Hi', max_output_tokens=300,
        )

    async def test_provider_failure_is_sanitized(self):
        with patch('app.main.generate_response', AsyncMock(
            side_effect=APIConnectionError(request=None)
        )):
            with self.assertRaises(HTTPException) as caught:
                await chat(ChatRequest(message='Hi'))
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(caught.exception.detail,
                         'AI provider request failed. Check server logs.')

    async def test_existing_endpoints(self):
        self.assertEqual((await health())['status'], 'healthy')
        self.assertEqual((await root())['version'], '0.1.0')

    async def test_safe_structured_status_logging(self):
        for code, expected in [('insufficient_quota', 'insufficient_quota'),
                               ('sensitive-value', 'unrecognized')]:
            error = APIStatusError(
                'sensitive-message',
                response=httpx.Response(429, request=httpx.Request('POST', 'https://example.com')),
                body={'code': code, 'message': 'sensitive-content'},
            )
            with patch('app.main.generate_response', AsyncMock(side_effect=error)):
                with self.assertLogs('app.main', level='ERROR') as logs:
                    with self.assertRaises(HTTPException):
                        await chat(ChatRequest(message='private user content'))
            record = json.loads(logs.records[0].getMessage())
            self.assertEqual(record, {
                'event': 'openai_request_failed', 'exception_type': 'APIStatusError',
                'http_status': 429, 'provider_error_code': expected,
            })
            self.assertNotIn('sensitive', logs.output[0])
            self.assertNotIn('private', logs.output[0])

    async def test_http_endpoints(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__(
                'app.main', fromlist=['app']).app), base_url='http://test') as client:
            self.assertEqual((await client.get('/')).status_code, 200)
            self.assertEqual((await client.get('/health')).status_code, 200)
            self.assertEqual((await client.post('/api/v1/chat', json={'message': ''})).status_code, 422)
            with patch('app.main.generate_response', AsyncMock(return_value='Hello')):
                response = await client.post('/api/v1/chat', json={'message': 'Hi'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'response': 'Hello'})

    async def test_ollama_default_without_key(self):
        async def respond(request):
            payload = json.loads(request.content)
            self.assertEqual(payload['model'], 'qwen3:4b')
            self.assertFalse(payload['think'])
            self.assertFalse(payload['stream'])
            return httpx.Response(200, json={'message': {'content': 'Local hello'}})
        real_client = httpx.AsyncClient
        with patch.dict('os.environ', {}, clear=True), patch.object(
            llm.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(
                transport=httpx.MockTransport(respond), **kw)):
            self.assertEqual(await llm.generate_response('Hi'), 'Local hello')

    async def test_ollama_failures(self):
        for failure in [httpx.ConnectError('private'), httpx.ReadTimeout('private'),
                        httpx.HTTPStatusError('private', request=None,
                            response=httpx.Response(404)), llm.ProviderError('invalid_response')]:
            with patch('app.main.generate_response', AsyncMock(side_effect=failure)):
                with self.assertLogs('app.main', level='ERROR') as logs:
                    with self.assertRaises(HTTPException) as caught:
                        await chat(ChatRequest(message='Hi'))
                self.assertEqual(caught.exception.status_code, 502)
                self.assertNotIn('private', logs.output[0])

    async def test_invalid_configuration(self):
        for env in [{'LLM_PROVIDER': 'unknown'}, {'LLM_PROVIDER': 'openai'}]:
            with patch.dict('os.environ', env, clear=True):
                with self.assertRaises(llm.ProviderError):
                    await llm.generate_response('Hi')

    async def test_ollama_reasoning_output(self):
        cases = [
            ({'content': 'Final', 'thinking': 'Hidden reasoning'}, 'Final'),
            ({'content': '<think>Reasoning</think> Final'}, 'Final'),
            ({'content': 'Reasoning without opening tag</think>Final'}, 'Final'),
            ({'content': '<think></think>Final'}, 'Final'),
            ({'content': '  Plain answer  '}, 'Plain answer'),
            ({'content': '<think>Unfinished reasoning'}, None),
            ({'content': '<think>Reasoning</think>'}, None),
            ({'content': '', 'thinking': 'Reasoning only'}, None),
        ]
        real_client = httpx.AsyncClient
        for message, expected in cases:
            with self.subTest(message=message):
                def respond(request):
                    payload = json.loads(request.content)
                    self.assertFalse(payload['think'])
                    self.assertIn('/no_think', payload['messages'][0]['content'])
                    return httpx.Response(200, json={'message': message})
                with patch.dict('os.environ', {}, clear=True), patch.object(
                    llm.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(
                        transport=httpx.MockTransport(respond), **kw)):
                    if expected is None:
                        with self.assertRaises(llm.ProviderError):
                            await llm.generate_response('Hi')
                    else:
                        result = await chat(ChatRequest(message='Hi'))
                        self.assertEqual(result.response, expected)
