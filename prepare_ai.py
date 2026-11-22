#!/usr/bin/env python3
"""Explicitly download a Whisper model. Never invoked by the web application."""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Descarga explícita del modelo Whisper para ECHO-404.')
    parser.add_argument('--model', choices=['tiny', 'base', 'small'], default='base')
    args = parser.parse_args()
    try:
        from faster_whisper.utils import download_model
    except ImportError:
        raise SystemExit('Instala requirements-ai.txt en .venv-ai antes de descargar el modelo.')
    parent = ROOT / 'models'
    parent.mkdir(exist_ok=True)
    destination = parent / ('whisper-' + args.model)
    print('Descargando Whisper ' + args.model + ' desde Hugging Face a ' + str(destination), flush=True)
    try:
        download_model(args.model, output_dir=str(destination))
    except (OSError, RuntimeError) as error:
        raise SystemExit('Falló la descarga del modelo: ' + str(error))
    files = {}
    vocab = 'vocabulary.txt' if (destination / 'vocabulary.txt').is_file() else 'vocabulary.json'
    for name in ['model.bin', 'config.json', 'tokenizer.json', vocab]:
        path = destination / name
        if not path.is_file() or not path.stat().st_size:
            raise SystemExit('Descarga incompleta: falta ' + name)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        files[name] = {'size': path.stat().st_size, 'sha256': digest.hexdigest()}
    (destination / 'echo-model.json').write_text(json.dumps({'model': args.model, 'files': files}, indent=2), encoding='utf-8')
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=parent, delete=False) as marker:
        marker.write(args.model)
    os.replace(marker.name, parent / 'whisper-activo.txt')
    print('Modelo listo. Las transcripciones se ejecutarán con archivos locales; no descargan modelos.', flush=True)
