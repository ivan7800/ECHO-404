"""Real, offline HTTP inference with synthetic speech and a 91-minute timeline.

Usage: python tests/verify_long_whisper.py /absolute/path/to/whisper-small
Run with the interpreter containing faster-whisper. Requires ffmpeg on PATH.
"""
from pathlib import Path
import json
import subprocess
import sys
import tempfile

tests = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as directory:
    long_file = Path(directory) / 'spanish.flac'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(tests/'fixtures/es.ogg'),
                    '-filter_complex', '[0:a]asplit[a][b];[b]adelay=5460000:all=1[c];[a][c]amix=normalize=0',
                    '-ar', '16000', str(long_file)], check=True)
    for language, clip in [('ca', tests/'fixtures/ca.ogg'), ('es', long_file)]:
        run = subprocess.run([sys.executable, str(tests/'verify_inference.py'), '--audio', str(clip),
                              '--whisper-model', sys.argv[1], '--language', language, '--expect', 'Barcelona'],
                             capture_output=True, text=True)
        print(run.stdout, flush=True)
        if run.returncode:
            raise RuntimeError(run.stderr)
        result = json.JSONDecoder().raw_decode(run.stdout[run.stdout.index('{\n'):])[0]
        if language == 'es':
            assert result['duration'] > 5460
            assert result['segments'][0]['start'] < 5 and result['segments'][-1]['end'] > 5460
