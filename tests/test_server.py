import contextlib
import copy
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from zipfile import ZipFile
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import empty_state, init_db, make_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = make_server(0, self.temp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def call(self, path, data=None, extra=None):
        headers = {'Content-Type': 'application/json', 'X-Echo-Client': 'echo-404'}
        headers.update(extra or {})
        request = urllib.request.Request(self.url + path, data=None if data is None else json.dumps(data).encode(), headers=headers, method='GET' if data is None else 'PUT')
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_roundtrip_tasks_decisions_and_revision_conflict(self):
        state = empty_state()
        state['meetings'] = [{'id': 'm1', 'title': 'Reunión', 'notes': 'Notas', 'transcript': 'Texto', 'summary': 'Resumen', 'decisions': 'Aprobado', 'project': 'Soporte', 'tags': ['VPN'], 'date': '2026-11-20', 'updatedAt': '2026-11-20', 'audioId': None, 'duration': 0}]
        state['tasks'] = [{'id': 't1', 'text': 'Revisar', 'owner': 'I. Roig', 'due': '2026-11-23', 'status': 'doing', 'priority': 'high', 'meetingId': 'm1'}]
        self.assertEqual(self.call('/api/state', {'expectedRevision': 0, 'state': state})[0], 200)
        read = self.call('/api/state')[1]
        self.assertEqual(read['state'], state)
        self.assertEqual(self.call('/api/state', {'expectedRevision': 0, 'state': state})[0], 409)
        self.assertEqual(self.call('/api/state')[1]['revision'], 1)

    def test_purge_removes_snapshots_only_at_matching_revision(self):
        state = empty_state()
        self.assertEqual(self.call('/api/state', {'expectedRevision': 0, 'state': state})[0], 200)
        payload = {'expectedRevision': 0, 'state': state, 'purgeHistory': True}
        self.assertEqual(self.call('/api/state', payload)[0], 409)
        with sqlite3.connect(self.server.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 1)
            payload['expectedRevision'] = 1
            self.assertEqual(self.call('/api/state', payload)[0], 200)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 0)

    def test_rejects_malformed_rows_and_preserves_data(self):
        broken = empty_state(); broken['meetings'] = [None]
        self.assertEqual(self.call('/api/state', {'expectedRevision': 0, 'state': broken})[0], 400)
        self.assertEqual(self.call('/api/state')[1]['revision'], 0)

    def test_blocks_cross_origin_and_missing_header(self):
        body = {'expectedRevision': 0, 'state': empty_state()}
        self.assertEqual(self.call('/api/state', body, {'Origin': 'https://example.org'})[0], 403)
        self.assertEqual(self.call('/api/state', body, {'X-Echo-Client': ''})[0], 403)
        self.assertEqual(self.call('/api/state', extra={'Host': 'evil.example:4173'})[0], 403)

    def test_database_and_source_are_not_static_assets(self):
        for path in ['/echo-404.sqlite3', '/server.py', '/../server.py', '/project_sources/05-AGENTS.md']:
            self.assertEqual(self.call(path)[0], 404)

    def test_ai_routes_validate_upload_and_summary_before_start(self):
        for endpoint, mime, data, expected in [
            ('transcriptions', 'audio/flac', b'', 413),
            ('transcriptions', 'text/plain', b'prueba', 415),
            ('transcriptions?language=invalid', 'audio/wav', b'a', 400),
            ('summaries', 'application/json', b'{"text":"","model":"local"}', 400),
            ('summaries', 'application/json', b'[]', 400),
        ]:
            req = urllib.request.Request(self.url + '/api/ai/' + endpoint, data=data,
                                         headers={'Content-Type': mime, 'X-Echo-Client': 'echo-404'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(req)
            self.assertEqual(error.exception.code, expected)
            self.assertIsNone(self.server.ai.active)

    def test_new_ui_module_is_served_and_unknown_job_is_not_found(self):
        with urllib.request.urlopen(self.url + '/ai-client.js') as response:
            self.assertEqual(response.status, 200)
            self.assertIn('javascript', response.headers.get_content_type())
        self.assertEqual(self.call('/api/ai/jobs/unknown')[0], 404)

    def test_word_export_contains_the_transcript_and_escapes_xml(self):
        request = urllib.request.Request(self.url + '/api/export/docx',
            data=json.dumps({'title': 'Reunión & soporte', 'text': 'Línea <uno> & dos\nAcuerdo final'}).encode(),
            headers={'Content-Type': 'application/json', 'X-Echo-Client': 'echo-404'})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers.get_content_type(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            with ZipFile(BytesIO(response.read())) as document:
                xml = document.read('word/document.xml').decode('utf-8')
                self.assertIn('Línea &lt;uno&gt; &amp; dos', xml)
                self.assertIn('Acuerdo final', xml)
        self.assertEqual(self.call('/api/state')[1]['revision'], 0)
        invalid = urllib.request.Request(self.url + '/api/export/docx', data=b'{"title":"A","text":""}',
            headers={'Content-Type': 'application/json', 'X-Echo-Client': 'echo-404'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(invalid)
        self.assertEqual(error.exception.code, 400)

    def test_snapshot_and_explicit_empty_state_do_not_resurrect_data(self):
        state = empty_state()
        self.assertEqual(self.call('/api/state', {'expectedRevision': 0, 'state': state})[0], 200)
        state['settings']['language'] = 'ca-ES'
        self.assertEqual(self.call('/api/state', {'expectedRevision': 1, 'state': state})[0], 200)
        with contextlib.closing(sqlite3.connect(self.server.db_path)) as conn:
            rows = conn.execute('SELECT revision,body FROM snapshots ORDER BY revision').fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(json.loads(rows[0][1])['settings']['language'], 'es-ES')
        init_db(self.server.db_path)
        self.assertEqual(self.call('/api/state')[1]['state']['settings']['language'], 'ca-ES')

    def test_old_sqlite_migrates_without_deleting_original_rows(self):
        path = Path(self.temp.name) / 'legacy.sqlite3'
        with contextlib.closing(sqlite3.connect(path)) as conn, conn:
            conn.execute('CREATE TABLE meetings (id TEXT,title TEXT,notes TEXT,date TEXT,updated_at TEXT,audio_path TEXT)')
            conn.execute('INSERT INTO meetings VALUES(?,?,?,?,?,?)', ('old', 'Antigua', 'Nota\n\nTRANSCRIPCIÓN:\nVoz', '2026-11-20', '2026-11-20', None))
        init_db(path)
        with contextlib.closing(sqlite3.connect(path)) as conn:
            state = json.loads(conn.execute('SELECT body FROM app_state').fetchone()[0])
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM meetings').fetchone()[0], 1)
        self.assertEqual(state['meetings'][0]['transcript'], 'Voz')


if __name__ == '__main__':
    unittest.main()
