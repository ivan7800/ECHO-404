@echo off
setlocal
title ECHO-404
cd /d "%~dp0"
py -3 -c "import sys; raise SystemExit(sys.version_info < (3,9))" >nul 2>&1
if not errorlevel 1 (
  py -3 server.py --open
  goto end
)
python -c "import sys; raise SystemExit(sys.version_info < (3,9))" >nul 2>&1
if not errorlevel 1 (
  python server.py --open
  goto end
)
echo Necesitas Python 3.9 o posterior. Descargalo desde https://www.python.org/downloads/
:end
echo.
echo Servidor detenido. Puedes cerrar esta ventana.
pause
