import asyncio
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx2 as httpx
from app.main import app
from app.services import speech


class SpeechTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_validation_and_formats(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch('app.services.transcription_api.transcribe_audio', return_value='Hello') as mock:
                for name, mime in [('clip.wav', 'audio/wav'), ('clip.mp3', 'audio/mpeg')]:
                    response = await client.post('/api/v1/transcribe', files={'file': (name, b'audio', mime)})
                    self.assertEqual(response.json(), {'text': 'Hello'})
                mock.reset_mock()
                for name, data, mime, status in [
                    ('x.txt', b'a', 'text/plain', 415),
                    ('x.wav', b'a', 'text/plain', 415),
                    ('x.wav', b'', 'audio/wav', 400),
                    ('x.wav', b'a' * (speech.MAX_AUDIO_BYTES + 1), 'audio/wav', 413),
                ]:
                    response = await client.post('/api/v1/transcribe', files={'file': (name, data, mime)})
                    self.assertEqual(response.status_code, status)
                mock.assert_not_called()
                self.assertEqual((await client.post('/api/v1/transcribe')).status_code, 422)

    async def test_worker_and_sanitized_failure(self):
        loop_thread = threading.get_ident()
        def fail(data):
            self.assertNotEqual(threading.get_ident(), loop_thread)
            raise ValueError('private audio metadata')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch('app.services.transcription_api.transcribe_audio', side_effect=fail):
                response = await client.post('/api/v1/transcribe', files={'file': ('x.wav', b'bad', 'audio/wav')})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private', response.text)

    async def test_lazy_model_reuse_and_generator(self):
        model = Mock()
        model.transcribe.side_effect = lambda *a, **kw: (
            iter([SimpleNamespace(text=' Hello '), SimpleNamespace(text='world ')]), None)
        factory = Mock(return_value=model)
        with patch.object(speech, '_model', None), patch.dict(sys.modules, {
            'faster_whisper': SimpleNamespace(WhisperModel=factory)
        }), patch.dict('os.environ', {'WHISPER_MODEL': 'base'}):
            results = await asyncio.gather(*[
                asyncio.to_thread(speech.transcribe_audio, b'audio') for _ in range(2)])
            self.assertEqual(results, ['Hello world', 'Hello world'])
            factory.assert_called_once_with('base', device='cpu', compute_type='int8', cpu_threads=4)
