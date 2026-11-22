# ECHO-404 1.6.2 · Verificación de grabación y transcripción

## Hallazgo y corrección

La versión anterior guardaba el audio en IndexedDB al detener la toma, pero no iniciaba Whisper. El reconocimiento de voz del navegador estaba desactivado por defecto y podía dar la impresión de que no se había grabado nada. Ahora la aplicación inicia Whisper tras guardar una nueva toma si el motor está preparado, aplica automáticamente el texto cuando la reunión no cambió durante el proceso y muestra un estado visible. Si falta Whisper, el audio permanece disponible para descargar.

## Evidencia

- `npm run check` y `npm test`: 19 pruebas JavaScript y 17 pruebas Python correctas; incluye la aplicación automática de una transcripción y exportación TXT, MD y DOCX.
- Whisper `faster-whisper` 1.2.1 con modelo real `base`: un WAV sintético generado sin conexión con `ffmpeg/flite` (voz inglesa que dice «This is a test meeting. Please send the report tomorrow.») produjo «This is a test meeting, please send the report tomorrow.» y una marca de tiempo. El trabajo HTTP terminó en unos dos segundos. Una muestra de silencio también terminó correctamente sin texto. Esto demuestra inferencia con voz, aunque no sustituye una grabación de micrófono real.
- Ollama 0.6.8 con pesos locales `qwen2.5:3b`: la API produjo un acta en unos 14 segundos. Identificó el acuerdo «Migrar el lunes» y la tarea de Elena con fecha `2026-12-01`. El modelo menor `qwen2.5:1.5b` omitió la fecha y clasificó mal el acuerdo en la misma muestra; las actas deben revisarse.
- El lanzador Linux arranca el servidor y responde al chequeo HTTP. `bash -n` revisa la sintaxis de los lanzadores de shell. La prueba de Chromium de Playwright se intentó con `/usr/bin/chromium`, pero el navegador abortó porque el entorno impide crear su socket de proceso (`Operation not permitted`).

## Pendiente para certificación de equipo real

No se ha podido usar un micrófono físico ni abrir Chromium en este entorno. Tampoco se ha ejecutado el lanzador Windows en Windows 11 ni el Linux en una instalación de Mint. La prueba `npm run test:ui` incluye un micrófono simulado, persistencia de audio, transcripción automática y descargas, y debe ejecutarse en un equipo con Chromium de Playwright. En Windows y Mint hay que conceder permiso de micrófono, grabar una frase, detener, verificar que aparece en Transcripción, descargar TXT/MD/DOCX, recargar y confirmar que siguen audio y texto.
