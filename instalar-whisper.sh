#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "$0")"
if [ ! -x .venv-ai/bin/python ]; then
  python3 -m venv .venv-ai || { echo 'No se pudo crear el entorno. En Linux Mint comprueba que python3-venv está instalado.' >&2; exit 1; }
fi
.venv-ai/bin/python -m pip install --only-binary=av -r requirements-ai.txt
exec .venv-ai/bin/python prepare_ai.py --model "${1:-base}"
