#!/usr/bin/env python3
"""Create a reproducible Windows/Linux archive without user data or models."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.6.3-rc.1'
FILES = [
    'README.md', 'CHANGELOG.md', 'RELEASE-CANDIDATE.md', 'LEEME_LANZADORES.txt',
    'CONFIGURACION-IA.md', 'QA-v1.6.1.md', 'QA-v1.6.2.md',
    'INICIAR_ECHO-404.bat', 'INICIAR_ECHO-404.ps1', 'iniciar-echo-404.sh',
    'INSTALAR_WHISPER.bat', 'instalar-whisper.sh', 'requirements-ai.txt',
    'package.json', 'server.py', 'ai_jobs.py', 'ai_worker.py', 'local_ai.py',
    'prepare_ai.py', 'document_export.py', 'app.js', 'ai-client.js',
    'transcript-export.js', 'model.js', 'storage.js', 'sw.js', 'index.html',
    'styles.css', 'theme.css', 'theme-init.js', 'icon.svg', 'manifest.webmanifest',
]
FILES += [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('*')) if p.is_file()]


def main():
    output = ROOT / 'dist' / f'ECHO-404-v{VERSION}-Windows-Linux.zip'
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for name in FILES:
            path = ROOT / name
            data = path.read_bytes()
            if path.suffix == '.bat':
                data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
            item = ZipInfo('ECHO-404/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = ZIP_DEFLATED
            item.external_attr = (0o755 if path.suffix == '.sh' else 0o644) << 16
            archive.writestr(item, data)
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert not any('sqlite' in n or '/models/' in n or '/.venv-ai/' in n for n in archive.namelist())
    print(output)


if __name__ == '__main__':
    main()
