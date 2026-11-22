"""Start the shipped launcher from a clean ZIP extraction, then stop its process tree."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from urllib.request import urlopen
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
windows = os.name == 'nt'
with tempfile.TemporaryDirectory() as directory:
    with ZipFile(next((root / 'dist').glob('*.zip'))) as archive:
        archive.extractall(directory)
    command = ['cmd', '/c', 'INICIAR_ECHO-404.bat'] if windows else ['bash', 'iniciar-echo-404.sh']
    process = subprocess.Popen(command, cwd=Path(directory) / 'ECHO-404',
                               env={**os.environ, 'BROWSER': 'true'}, start_new_session=not windows)
    try:
        for attempt in range(60):
            try:
                with urlopen('http://127.0.0.1:4173/api/health', timeout=1) as response:
                    print(json.load(response))
                assert (Path(directory) / 'ECHO-404' / 'echo-404.sqlite3').is_file()
                break
            except OSError:
                if process.poll() is not None or attempt == 59:
                    raise
                time.sleep(.25)
    finally:
        if process.poll() is None:
            if windows:
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=True)
            else:
                os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)
