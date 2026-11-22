import io
import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_jobs import AIJobs
from local_ai import AIError, SUMMARY_SCHEMA, local_models, summarize, validate_summary


class OllamaContract(unittest.TestCase):
    def setUp(self):
        self.posts = []
        self.shown = {}
        self.reply = {'done': True, 'message': {'content': json.dumps({
            'summary': 'Resumen', 'decisions': ['Migrar'], 'tasks': [{'text': 'Enviar', 'owner': 'Elena', 'due': '2026-12-01'}]})}}
        case = self

        class Handler(BaseHTTPRequestHandler):
            def respond(self, data):
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                self.respond({'models': [{'name': 'local', 'size': 10}, {'name': 'remote:cloud', 'size': 2},
                                          {'name': 'remote', 'remote_host': 'cloud', 'size': 3}]})

            def do_POST(self):
                case.posts.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.respond(case.shown if self.path == '/api/show' else case.reply)

            def log_message(self, *args):
                pass

        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.http.server_port

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def test_schema_local_model_and_content(self):
        self.assertEqual(local_models(self.port), ['local'])
        result = summarize('Reunión del lunes', 'local', self.port)
        self.assertEqual(result['tasks'][0]['owner'], 'Elena')
        self.assertEqual(self.posts[1][0], '/api/chat')
        self.assertEqual(self.posts[1][1]['format'], SUMMARY_SCHEMA)
        self.assertFalse(self.posts[1][1]['stream'])
        self.assertIn('Reunión del lunes', self.posts[1][1]['messages'][1]['content'])

    def test_remote_model_blocked_before_chat(self):
        self.shown = {'remote_model': 'otro'}
        with self.assertRaises(AIError) as error:
            summarize('Reunión', 'local', self.port)
        self.assertEqual(error.exception.code, 'remote_model_blocked')
        self.assertEqual(len(self.posts), 1)

    def test_rejects_partial_and_invalid_output(self):
        for reply in [{'done': True, 'done_reason': 'length'}, {'done': True, 'message': {'content': 'sin JSON'}}]:
            self.reply = reply
            with self.assertRaises(AIError):
                summarize('Reunión', 'local', self.port)

    def test_invalid_date_unassigned_and_missing_task_fields_rejected(self):
        task = {'text': 'Enviar', 'due': '2026-02-31', 'owner': ''}
        result = {'summary': 'Resumen', 'decisions': [], 'tasks': [task]}
        self.assertEqual(validate_summary(result)['tasks'][0]['due'], '')
        del task['owner']
        with self.assertRaises(AIError):
            validate_summary(result)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.worker = self.root / 'test_worker.py'
        self.worker.write_text('import time\ntime.sleep(60)\n', encoding='utf-8')
        self.jobs = AIJobs(python=sys.executable, worker=self.worker, timeout=5)
        self.addCleanup(self.jobs.close)

    def wait(self, job):
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            result = self.jobs.get(job['id'])
            if result['state'] in ['done', 'failed', 'cancelled'] and self.jobs.active is None:
                return result
            time.sleep(0.03)
        self.fail('Job did not finish')

    def test_cancel_busy_and_cleanup(self):
        job = self.jobs.start('summary', {})
        with self.assertRaises(AIError) as error:
            self.jobs.start('summary', {})
        self.assertEqual(error.exception.code, 'busy')
        self.assertTrue(self.jobs.cancel(job['id']))
        self.assertEqual(self.wait(job)['state'], 'cancelled')
        self.assertIsNone(self.jobs.active)

    def test_timeout_releases_slot(self):
        self.jobs.timeout = 0.15
        job = self.jobs.start('summary', {})
        self.assertEqual(self.wait(job)['error']['code'], 'timeout')

    def test_interrupted_upload_releases_slot(self):
        with self.assertRaises(AIError) as error:
            self.jobs.start('transcription', {}, io.BytesIO(b'ab'), 4)
        self.assertEqual(error.exception.code, 'incomplete_audio')
        self.assertIsNone(self.jobs.active)

    def test_temp_creation_failure_releases_slot(self):
        with patch('ai_jobs.tempfile.TemporaryDirectory', side_effect=OSError('full')):
            with self.assertRaises(OSError):
                self.jobs.start('summary', {})
        self.assertIsNone(self.jobs.active)
