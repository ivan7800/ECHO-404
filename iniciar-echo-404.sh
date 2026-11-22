#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Necesitas Python 3.9 o posterior.' >&2
  exit 1
fi
exec python3 server.py --open
