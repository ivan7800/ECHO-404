#!/usr/bin/env python3
"""One inference per child process; results are written to a private job directory."""
import json
import os
import sys
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
from local_ai import AIError, summarize, transcribe

if __name__ == '__main__':
    directory = Path(sys.argv[1])
    payload = json.loads((directory / 'input.json').read_text(encoding='utf-8'))
    try:
        if payload['kind'] == 'transcription':
            def report(done, total):
                temporary = directory / 'progress.tmp'
                temporary.write_text(str(int(done * 100 / total)), encoding='ascii')
                temporary.replace(directory / 'progress')
            result = transcribe(directory / 'audio', payload['modelPath'], payload['language'], report)
        else:
            result = summarize(payload['text'], payload['model'])
        response = {'result': result}
    except AIError as error:
        response = {'error': {'code': error.code, 'message': str(error)}}
    except Exception:
        response = {'error': {'code': 'worker_failed', 'message': 'No se pudo completar el proceso local de IA.'}}
    (directory / 'output.json').write_text(json.dumps(response, ensure_ascii=False), encoding='utf-8')
