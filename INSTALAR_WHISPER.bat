@echo off
setlocal
cd /d "%~dp0"
if exist ".venv-ai\Scripts\python.exe" goto install
where py >nul 2>&1
if errorlevel 1 goto python
py -3 -m venv .venv-ai
if errorlevel 1 goto failed
goto install
:python
python -m venv .venv-ai
if errorlevel 1 goto failed
:install
".venv-ai\Scripts\python.exe" -m pip install --only-binary=av -r requirements-ai.txt
if errorlevel 1 goto failed
".venv-ai\Scripts\python.exe" prepare_ai.py %*
if errorlevel 1 goto failed
echo Whisper listo. Reinicia ECHO-404.
pause
exit /b 0
:failed
echo No se ha podido preparar Whisper. Consulta CONFIGURACION-IA.md.
pause
exit /b 1
