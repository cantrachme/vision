import unittest
from unittest.mock import patch

import httpx2 as httpx
from app.main import app
from app.services.text_sanitizer import remove_emojis
from app.services import tts, llm


class EmojiTests(unittest.IsolatedAsyncioTestCase):
    def test_sequences(self):
        for text in ['😀', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇮🇳🇺🇸', '❤️', '1️⃣', '🏳️‍🌈', '👍🏿', '👨‍👩🏿‍👧🏻‍👦🏾']:
            with self.subTest(text=text):
                self.assertEqual(remove_emojis('Hello' + text + '!'), 'Hello!')

    def test_plain_text_unchanged(self):
        for text in ['Hello, world! 123 # *', 'नमस्ते दुनिया — 你好！', '© ® ™ → ± € $ = +', '  Hello.\n']:
            self.assertEqual(remove_emojis(text), text)

    async def test_direct_api_sanitizes_and_rejects_empty(self):
        with patch.object(tts.platform, 'system', return_value='Darwin'), patch.object(tts.subprocess, 'run') as run:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post('/api/v1/speak', json={'text': 'Hello👩🏽‍💻!'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(run.call_args.kwargs['input'], 'Hello!')
                run.reset_mock()
                response = await client.post('/api/v1/speak', json={'text': ' 👩🏽‍💻 🇮🇳 ❤️ '})
                self.assertEqual(response.status_code, 422)
                run.assert_not_called()

    def test_shared_system_instructions(self):
        self.assertIn('Never generate emojis or decorative symbols.', llm.SYSTEM_PROMPT)
        self.assertIn('suitable for speaking aloud.', llm.SYSTEM_PROMPT)
        self.assertIn('Avoid unnecessary follow-up questions.', llm.SYSTEM_PROMPT)
