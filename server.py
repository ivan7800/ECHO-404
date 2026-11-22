#!/usr/bin/env python3
"""Loopback meeting workspace, SQLite persistence and local inference jobs."""
import argparse
import contextlib
import json
import re
import sqlite3
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from ai_jobs import AIJobs, MAX_AUDIO
from local_ai import AIError
from document_export import word_document

ROOT = Path(__file__).resolve().parent
VERSION = '1.6.3-rc.2'
ASSETS = {'index.html': 'text/html', 'styles.css': 'text/css', 'theme.css': 'text/css',
          'app.js': 'text/javascript', 'model.js': 'text/javascript', 'storage.js': 'text/javascript',
          'theme-init.js': 'text/javascript', 'ai-client.js': 'text/javascript', 'sw.js': 'text/javascript',
          'transcript-export.js': 'text/javascript',
          'manifest.webmanifest': 'application/manifest+json', 'icon.svg': 'image/svg+xml'}
MAX_BODY = 8 * 1024 * 1024


def empty_state():
    return {'schema': 'echo-404-v2', 'meetings': [], 'tasks': [],
            'settings': {'language': 'es-ES', 'autoBackup': True, 'speechEnabled': False}}


def validate_state(state):
    if not isinstance(state, dict) or state.get('schema') != 'echo-404-v2':
        raise ValueError('Esquema de datos no válido')
    for collection, limit in [('meetings', 10000), ('tasks', 50000)]:
        rows = state.get(collection)
        if not isinstance(rows, list) or len(rows) > limit:
            raise ValueError('Colección no válida: ' + collection)
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('Registro no válido')
            rid = row.get('id')
            if not isinstance(rid, str) or not re.fullmatch(r'[\w-]{1,100}', rid) or rid in seen:
                raise ValueError('Identificador no válido o repetido')
            seen.add(rid)
            fields = ['title', 'notes', 'transcript', 'summary', 'decisions', 'project', 'date', 'updatedAt'] if collection == 'meetings' else ['text', 'owner', 'due', 'status', 'priority']
            if any(not isinstance(row.get(field), str) for field in fields):
                raise ValueError('Faltan campos de texto')
            if collection == 'meetings':
                tags = row.get('tags')
                if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(t, str) or len(t) > 40 for t in tags):
                    raise ValueError('Etiquetas no válidas')
                if len(row['title']) > 300 or len(row['notes']) > 200000 or len(row['transcript']) > 200000:
                    raise ValueError('Texto demasiado largo')
            elif row['status'] not in ['todo', 'doing', 'done'] or row['priority'] not in ['high', 'normal', 'low']:
                raise ValueError('Estado o prioridad no válidos')
    if not isinstance(state.get('settings'), dict):
        raise ValueError('Configuración no válida')
    return state


def init_db(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(sqlite3.connect(path)) as conn, conn:
        conn.execute('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS snapshots (revision INTEGER PRIMARY KEY, body TEXT NOT NULL, date TEXT NOT NULL)')
        if conn.execute('SELECT 1 FROM app_state WHERE id=1').fetchone():
            return
        state = empty_state()
        legacy = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'").fetchone()
        if legacy:
            conn.row_factory = sqlite3.Row
            for row in conn.execute('SELECT * FROM meetings ORDER BY date'):
                notes, _, transcript = row['notes'].partition('\n\nTRANSCRIPCIÓN:\n')
                if transcript.startswith(('La transcripción aparecerá', 'Este navegador no ofrece')):
                    transcript = ''
                state['meetings'].append({'id': row['id'], 'title': row['title'], 'notes': notes, 'transcript': transcript,
                    'summary': '', 'decisions': '', 'project': '', 'tags': [], 'date': row['date'],
                    'updatedAt': row['updated_at'], 'duration': 0, 'audioId': None})
        conn.execute('INSERT INTO app_state VALUES(1,0,?)', (json.dumps(state, ensure_ascii=False),))


class Handler(BaseHTTPRequestHandler):
    def headers_for(self, status, mime, size):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.headers_for(status, 'application/json; charset=utf-8', len(body))
        self.wfile.write(body)

    def allowed(self, write=False, audio=False):
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in allowed:
            self.send_json({'error': 'host_not_allowed'}, 403)
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://' + host for host in allowed}:
            self.send_json({'error': 'origin_not_allowed'}, 403)
            return False
        if write and (self.headers.get('X-Echo-Client') != 'echo-404' or (not audio and self.headers.get_content_type() != 'application/json')):
            self.send_json({'error': 'client_header_required'}, 403)
            return False
        return True

    def do_GET(self):
        if not self.allowed():
            return
        path = urlsplit(self.path).path
        if path == '/api/health':
            self.send_json({'ok': True, 'service': 'echo-404', 'version': VERSION, 'storage': 'sqlite'})
            return
        if path == '/api/ai/status':
            self.send_json(self.server.ai.status())
            return
        if path.startswith('/api/ai/jobs/'):
            job = self.server.ai.get(path.rsplit('/', 1)[-1])
            self.send_json(job or {'error': 'not_found'}, 200 if job else 404)
            return
        if path in ['/api/state', '/api/meetings']:
            with contextlib.closing(sqlite3.connect(self.server.db_path)) as conn:
                revision, body = conn.execute('SELECT revision,body FROM app_state WHERE id=1').fetchone()
            state = json.loads(body)
            self.send_json({'revision': revision, 'state': state} if path == '/api/state' else {'meetings': state['meetings']})
            return
        name = 'index.html' if path == '/' else path[1:]
        if name not in ASSETS or not (ROOT / name).is_file():
            self.send_json({'error': 'not_found'}, 404)
            return
        body = (ROOT / name).read_bytes()
        self.headers_for(200, ASSETS[name] + '; charset=utf-8', len(body))
        self.wfile.write(body)

    def do_PUT(self):
        if not self.allowed(write=True):
            return
        if urlsplit(self.path).path != '/api/state':
            self.send_json({'error': 'not_found'}, 404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                self.send_json({'error': 'body_too_large_or_empty'}, 413)
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or type(payload.get('expectedRevision')) is not int:
                raise ValueError('Falta la revisión esperada')
            state = validate_state(payload.get('state'))
            body = json.dumps(state, ensure_ascii=False)
            with contextlib.closing(sqlite3.connect(self.server.db_path, timeout=10)) as conn, conn:
                conn.execute('BEGIN IMMEDIATE')
                revision, previous = conn.execute('SELECT revision,body FROM app_state WHERE id=1').fetchone()
                if payload['expectedRevision'] != revision:
                    self.send_json({'error': 'conflict', 'revision': revision}, 409)
                    return
                if state['settings'].get('autoBackup', True):
                    conn.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)', (revision, previous, datetime.now(timezone.utc).isoformat()))
                    conn.execute('DELETE FROM snapshots WHERE revision NOT IN (SELECT revision FROM snapshots ORDER BY revision DESC LIMIT 10)')
                conn.execute('UPDATE app_state SET revision=?,body=? WHERE id=1', (revision + 1, body))
            self.send_json({'ok': True, 'revision': revision + 1})
        except (ValueError, UnicodeError, TypeError):
            self.send_json({'error': 'invalid_state'}, 400)
        except sqlite3.Error:
            self.send_json({'error': 'database_unavailable'}, 503)

    def do_POST(self):
        path = urlsplit(self.path).path
        audio = path == '/api/ai/transcriptions'
        if not self.allowed(write=True, audio=audio):
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if path == '/api/export/docx':
                if not 0 < length <= 750000:
                    self.send_json({'error': 'body_limit'}, 413); return
                payload = json.loads(self.rfile.read(length))
                if (not isinstance(payload, dict) or not isinstance(payload.get('title'), str)
                        or not isinstance(payload.get('text'), str) or not 0 < len(payload['text'].strip()) <= 200000
                        or len(payload['title']) > 300):
                    raise ValueError()
                body = word_document(payload['title'], payload['text'])
                self.headers_for(200, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', len(body))
                self.wfile.write(body)
                return
            if audio:
                if not 0 < length <= MAX_AUDIO:
                    self.send_json({'error': 'audio_limit', 'message': 'El límite de audio es 128 MiB.'}, 413); return
                if self.headers.get_content_type() not in ['application/octet-stream', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/flac']:
                    self.send_json({'error': 'unsupported_audio', 'message': 'Formato de audio no permitido.'}, 415); return
                language = parse_qs(urlsplit(self.path).query).get('language', ['auto'])[0]
                if language not in ['auto', 'es', 'ca', 'en']:
                    raise ValueError()
                self.connection.settimeout(30)
                job = self.server.ai.start('transcription', {'language': language}, self.rfile, length)
            elif path == '/api/ai/summaries':
                if not 0 < length <= 100000:
                    self.send_json({'error': 'body_limit', 'message': 'Solicitud demasiado grande.'}, 413); return
                payload = json.loads(self.rfile.read(length))
                if (not isinstance(payload, dict) or not isinstance(payload.get('text'), str) or not 0 < len(payload['text'].strip()) <= 20000
                        or not isinstance(payload.get('model'), str) or not 0 < len(payload['model']) <= 200):
                    raise ValueError()
                job = self.server.ai.start('summary', {'text': payload['text'], 'model': payload['model']})
            else:
                self.send_json({'error': 'not_found'}, 404); return
            self.send_json(job, 202)
        except AIError as error:
            self.send_json({'error': error.code, 'message': str(error)}, 409 if error.code == 'busy' else 400)
        except (ValueError, UnicodeError, OSError):
            self.send_json({'error': 'invalid_request', 'message': 'No se pudo leer la solicitud.'}, 400)

    def do_DELETE(self):
        if not self.allowed(write=True):
            return
        path = urlsplit(self.path).path
        if not path.startswith('/api/ai/jobs/'):
            self.send_json({'error': 'not_found'}, 404); return
        found = self.server.ai.cancel(path.rsplit('/', 1)[-1])
        self.send_json({'ok': found}, 200 if found else 404)

    def log_message(self, fmt, *args):
        print('[ECHO-404]', fmt % args)


class EchoServer(ThreadingHTTPServer):
    def server_close(self):
        if hasattr(self, 'ai'):
            self.ai.close()
        super().server_close()


def make_server(port=4173, data_dir=None, model_path=None, ai=None):
    path = Path(data_dir or ROOT) / 'echo-404.sqlite3'
    server = EchoServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.db_path = path
    init_db(path)
    server.ai = ai or AIJobs(model_path=model_path)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--whisper-model', type=Path, help='Carpeta local de un modelo faster-whisper')
    parser.add_argument('--open', action='store_true', help='Abrir el navegador al iniciar')
    args = parser.parse_args()
    try:
        server = make_server(args.port, args.data_dir, args.whisper_model)
        url = f'http://127.0.0.1:{server.server_port}/'
        print('ECHO-404 ' + VERSION + ': ' + url + '\nCtrl+C para detener el servidor.', flush=True)
        if args.open:
            threading.Timer(0.3, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nServidor detenido.')
        finally:
            server.server_close()
    except OSError as error:
        print('No se pudo iniciar ECHO-404. Comprueba el puerto y los permisos:', error)
        raise SystemExit(1)
