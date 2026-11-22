"""Bounded, cancellable local inference jobs with temporary-file cleanup."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from local_ai import AIError, local_models, model_ready

ROOT = Path(__file__).resolve().parent
MAX_AUDIO = 128 * 1024 * 1024


class AIJobs:
    def __init__(self, model_path=None, python=None, worker=None, timeout=900):
        candidate = ROOT / '.venv-ai' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        self.python = str(python or (candidate if candidate.is_file() else sys.executable))
        self.worker = Path(worker or ROOT / 'ai_worker.py')
        models = ROOT / 'models'
        marker = models / 'whisper-activo.txt'
        selected = marker.read_text(encoding='utf-8').strip() if marker.is_file() else ''
        default_model = models / ('whisper-' + selected if selected in ['tiny', 'base', 'small'] else 'whisper')
        self.model_path = Path(model_path or default_model).resolve()
        self.timeout = timeout
        self.lock = threading.Lock()
        self.jobs = {}
        self.active = None
        self.closed = False
        self.probe_cache = None

    def status(self):
        if not self.probe_cache or time.monotonic() - self.probe_cache[0] > 30:
            try:
                probe = subprocess.run([self.python, '-c', 'import importlib.util; print(int(importlib.util.find_spec("faster_whisper") is not None))'],
                    capture_output=True, timeout=5, check=False, text=True)
                installed = probe.returncode == 0 and probe.stdout.strip() == '1'
            except (OSError, subprocess.TimeoutExpired):
                installed = False
            self.probe_cache = (time.monotonic(), installed)
        installed = self.probe_cache[1]
        try:
            models = local_models()
            ollama = {'available': True, 'models': models}
        except AIError as error:
            ollama = {'available': False, 'models': [], 'message': str(error)}
        ready = model_ready(self.model_path)
        return {'whisper': {'installed': installed, 'modelReady': ready, 'ready': installed and ready},
                'ollama': ollama, 'activeJob': self.active, 'maxAudioBytes': MAX_AUDIO, 'maxSummaryChars': 20000}

    def start(self, kind, payload, audio_stream=None, audio_size=0):
        with self.lock:
            if self.closed:
                raise AIError('server_stopping', 'El servidor se está cerrando.')
            if self.active:
                raise AIError('busy', 'Ya hay un proceso de IA activo. Espera o cancélalo.')
            for job_id in list(self.jobs):
                if len(self.jobs) < 8:
                    break
                if self.jobs[job_id]['state'] in ['done', 'failed', 'cancelled']:
                    del self.jobs[job_id]
            job_id = str(uuid.uuid4())
            job = {'id': job_id, 'kind': kind, 'state': 'running', 'createdAt': time.time(), 'cancel': threading.Event()}
            self.jobs[job_id] = job
            self.active = job_id
        directory = None
        try:
            directory = tempfile.TemporaryDirectory(prefix='echo404-ai-')
            folder = Path(directory.name)
            if kind == 'transcription':
                if not 0 < audio_size <= MAX_AUDIO:
                    raise AIError('audio_limit', 'El audio debe ocupar entre 1 byte y 128 MiB.')
                with (folder / 'audio').open('wb') as output:
                    remaining = audio_size
                    while remaining:
                        if job['cancel'].is_set():
                            raise AIError('cancelled', 'Se canceló la carga de audio.')
                        chunk = audio_stream.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise AIError('incomplete_audio', 'La carga del audio se interrumpió.')
                        output.write(chunk)
                        remaining -= len(chunk)
                payload = {**payload, 'modelPath': str(self.model_path)}
            (folder / 'input.json').write_text(json.dumps({**payload, 'kind': kind}, ensure_ascii=False), encoding='utf-8')
            thread = threading.Thread(target=self._run, args=(job, directory), daemon=True)
            with self.lock:
                if self.closed:
                    raise AIError('server_stopping', 'El servidor se está cerrando.')
                job['thread'] = thread
                thread.start()
            return self.get(job_id)
        except Exception:
            if directory is not None:
                directory.cleanup()
            with self.lock:
                self.jobs.pop(job_id, None)
                self.active = None
            raise

    def _run(self, job, directory):
        process = None
        folder = Path(directory.name)
        outcome = {'state': 'failed', 'error': {'code': 'worker_failed', 'message': 'No se pudo ejecutar el motor local.'}}
        try:
            environment = os.environ.copy()
            environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
            with (folder / 'worker.log').open('wb') as log:
                process = subprocess.Popen([self.python, str(self.worker), str(folder)], cwd=ROOT, env=environment,
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=log)
                start = time.monotonic()
                while process.poll() is None:
                    if job['cancel'].is_set() or time.monotonic() - start > self.timeout:
                        process.terminate()
                        try:
                            process.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.kill(); process.wait(timeout=3)
                        if job['cancel'].is_set():
                            return
                        raise AIError('timeout', 'El proceso local superó el tiempo máximo de 15 minutos.')
                    time.sleep(0.1)
            output = folder / 'output.json'
            if process.returncode or not output.is_file() or output.stat().st_size > 4 * 1024 * 1024:
                raise AIError('worker_failed', 'El motor local no terminó correctamente. Comprueba dependencias y memoria.')
            result = json.loads(output.read_text(encoding='utf-8'))
            if 'error' in result:
                outcome = {'state': 'failed', 'error': result['error']}
            else:
                outcome = {'state': 'done', 'result': result['result']}
        except AIError as error:
            outcome = {'state': 'failed', 'error': {'code': error.code, 'message': str(error)}}
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            pass
        finally:
            try:
                if process and process.poll() is None:
                    process.kill()
                    process.wait(timeout=3)
                directory.cleanup()
            except OSError:
                outcome = {'state': 'failed', 'error': {'code': 'cleanup_failed', 'message': 'No se pudo limpiar la carpeta temporal del proceso.'}}
            finally:
                with self.lock:
                    job.update({'state': 'cancelled'} if job['cancel'].is_set() else outcome)
                    if self.active == job['id']:
                        self.active = None

    def get(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            return {key: job[key] for key in ['id', 'kind', 'state', 'createdAt', 'result', 'error'] if key in job}

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False
            if job['state'] == 'running':
                job['cancel'].set(); job['state'] = 'cancelling'
            return True

    def close(self):
        with self.lock:
            self.closed = True
            threads = []
            for job in self.jobs.values():
                job['cancel'].set()
                if 'thread' in job: threads.append(job['thread'])
        for thread in threads:
            thread.join(timeout=5)
