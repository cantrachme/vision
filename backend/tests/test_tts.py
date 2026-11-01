import asyncio
import subprocess
import threading
import unittest
from unittest.mock import patch

import httpx2 as httpx
from app.main import app
from app.services import tts


class TTSTests(unittest.IsolatedAsyncioTestCase):
    async def test_safe_subprocess(self):
        text = '-v other; $(echo private)'
        with patch.object(tts.platform, 'system', return_value='Darwin'), patch.object(tts.subprocess, 'run') as run:
            await asyncio.to_thread(tts.speak_text, text)
            run.assert_called_once_with(['/usr/bin/say'], input=text, text=True,
                shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                check=True, timeout=60)

    async def test_busy_and_lock_release(self):
        with patch.object(tts.platform, 'system', return_value='Darwin'), patch.object(tts.subprocess, 'run', side_effect=OSError()):
            tts._lock.acquire()
            try:
                with self.assertRaises(tts.SpeechBusy):
                    tts.speak_text('Hi')
            finally:
                tts._lock.release()
            with self.assertRaises(OSError):
                tts.speak_text('Hi')
            self.assertFalse(tts._lock.locked())

    async def test_endpoint_validation_and_worker(self):
        thread = threading.get_ident()
        def speak(text):
            self.assertNotEqual(threading.get_ident(), thread)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch('app.services.tts_api.speak_text', side_effect=speak) as mock:
                response = await client.post('/api/v1/speak', json={'text': 'Hello'})
                self.assertEqual(response.json(), {'status': 'completed'})
                mock.reset_mock()
                for payload in [{}, {'text': ''}, {'text': '   '}, {'text': 'x' * 2001}, {'text': '\x00'}]:
                    self.assertEqual((await client.post('/api/v1/speak', json=payload)).status_code, 422)
                mock.assert_not_called()

    async def test_sanitized_errors(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for error, status in [(tts.SpeechUnavailable(), 501), (tts.SpeechBusy(), 409),
                (subprocess.TimeoutExpired('private', 60), 504),
                (subprocess.CalledProcessError(1, 'private'), 503), (OSError('private'), 503)]:
                with patch('app.services.tts_api.speak_text', side_effect=error):
                    response = await client.post('/api/v1/speak', json={'text': 'Hi'})
                self.assertEqual(response.status_code, status)
                self.assertNotIn('private', response.text)

    async def test_unsupported_platform(self):
        with patch.object(tts.platform, 'system', return_value='Linux'), patch.object(tts.subprocess, 'run') as run:
            with self.assertRaises(tts.SpeechUnavailable):
                tts.speak_text('Hi')
            run.assert_not_called()
