"""Opt-in test using the real HTTP service and engines installed on this computer."""
import argparse
import hashlib
import json
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import make_server


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--audio', type=Path)
    group.add_argument('--ollama-model')
    parser.add_argument('--whisper-model', type=Path)
    parser.add_argument('--language', default='auto', choices=['auto', 'en', 'es', 'ca'])
    parser.add_argument('--expect', help='Texto que debe aparecer en la transcripción')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory, make_server(0, directory, args.whisper_model) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, data=None, mime='application/json'):
            req = urllib.request.Request(url + path, data=data, headers={'X-Echo-Client': 'echo-404', 'Content-Type': mime})
            with opener.open(req, timeout=40) as response:
                return json.load(response)

        try:
            started = time.monotonic()
            if args.audio:
                audio = args.audio.read_bytes()
                job = request('/api/ai/transcriptions?language=' + args.language, audio, 'application/octet-stream')
                print('SHA-256', hashlib.sha256(audio).hexdigest(), flush=True)
            else:
                payload = {'model': args.ollama_model, 'text': 'Acordamos migrar el lunes. Elena enviará el informe el 2026-12-01.'}
                job = request('/api/ai/summaries', json.dumps(payload).encode())
            while job['state'] in ['running', 'cancelling'] and time.monotonic() - started < 930:
                time.sleep(0.5)
                job = request('/api/ai/jobs/' + job['id'])
            if job['state'] != 'done':
                raise RuntimeError(job.get('error', job['state']))
            result = job['result']
            if args.audio and (not result['text'] or not result['segments'] or
                               args.expect and args.expect.casefold() not in result['text'].casefold()):
                raise RuntimeError('La transcripción no coincide con la comprobación solicitada.')
            if args.ollama_model and not result['summary']:
                raise RuntimeError('Resumen vacío')
            print(json.dumps(result, ensure_ascii=False, indent=2))
            print(f'Tiempo de extremo a extremo: {time.monotonic() - started:.1f} s')
        finally:
            server.shutdown()
            thread.join()


if __name__ == '__main__':
    main()
