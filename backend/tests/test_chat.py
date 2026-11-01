import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from openai import APIConnectionError
from app.main import ChatRequest, chat, health, root
from app.services import llm


class ChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_request_and_response(self):
        create = AsyncMock(return_value=SimpleNamespace(output_text='Hello'))
        with patch.object(llm.client.responses, 'create', create):
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
