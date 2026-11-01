import importlib
import sys
import unittest
from unittest.mock import Mock, patch

import httpx2 as httpx


class VoiceChatTests(unittest.TestCase):
    def setUp(self):
        # No microphone dependency or device needed during tests.
        with patch.dict(sys.modules, {'sounddevice': Mock()}):
            self.module = importlib.import_module('scripts.voice_chat')
            self.recorder = importlib.import_module('scripts.record_and_transcribe')

    def run_chat(self, inputs, handler):
        real_client = httpx.Client
        with patch('builtins.input', side_effect=inputs), patch('builtins.print'), patch.object(
            self.module, 'record_audio', return_value=b'wav') as record, patch.object(
            self.module.httpx, 'Client', side_effect=lambda **kw: real_client(
                transport=httpx.MockTransport(handler), **kw)):
            self.module.main()
        return record

    def test_two_turns_reuse_session_and_wait(self):
        import json
        paths = []
        def handler(request):
            paths.append(request.url.path)
            if request.url.path.endswith('transcribe'):
                return httpx.Response(200, json={'text': 'Hi'})
            if request.url.path.endswith('chat'):
                payload = json.loads(request.content)
                self.assertEqual(payload.get('session_id'), 'session' if paths.count('/api/v1/chat') == 2 else None)
                return httpx.Response(200, json={'response': 'Hello', 'session_id': 'session'})
            return httpx.Response(200, json={'status': 'completed'})
        record = self.run_chat(['', '', 'q'], handler)
        self.assertEqual(record.call_count, 2)
        self.assertEqual(paths, ['/api/v1/transcribe', '/api/v1/chat', '/api/v1/speak'] * 2)

    def test_empty_and_connection_failure(self):
        for handler in [lambda r: httpx.Response(200, json={'text': ' '}),
                        Mock(side_effect=httpx.ConnectError('private'))]:
            self.run_chat(['', 'q'], handler)

    def test_interrupt(self):
        record = self.run_chat([KeyboardInterrupt], Mock())
        record.assert_not_called()

    def test_recording_stops_and_returns_wav(self):
        import io
        import wave
        recorder = self.recorder
        device = Mock()
        device.rec.return_value.tobytes.return_value = b'\x00\x00' * 10
        with patch.object(recorder, 'sd', device), patch('builtins.print'):
            data = recorder.record_audio()
        device.stop.assert_called_once()
        with wave.open(io.BytesIO(data)) as audio:
            self.assertEqual(audio.getframerate(), 16000)
            self.assertEqual(audio.getnchannels(), 1)
