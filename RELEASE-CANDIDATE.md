# ECHO-404 v1.6.3-rc.2

## Alcance

Candidata de revisión basada en 1.6.2. La grabación conserva el audio en IndexedDB; Whisper local inicia una transcripción automática tras detenerla. TXT, Markdown y DOCX descargan la transcripción. El encabezado del editor confirma el guardado solo cuando SQLite responde; si hay un conflicto o una copia pendiente, lo indica.

## Auditoría y resultados

- Lógica y servidor: `npm run check` y `npm test` (19 pruebas JavaScript y 17 Python) correctos en la preparación de esta RC.
- Inferencia: Whisper real `base` transcribió una muestra de voz sintética; Ollama local `qwen2.5:3b` devolvió acuerdo, tarea, responsable y fecha. Detalles reproducibles en `QA-v1.6.2.md`.
- Distribución: el empaquetador mantiene los lanzadores Windows/Linux y excluye SQLite, audios, modelos y entornos virtuales. Se comprueba el ZIP y el arranque de Linux desde una extracción limpia.
- Seguridad: el servidor escucha en `127.0.0.1`, limita los recursos HTTP, valida origen y revisiones de guardado, y no sirve SQLite. La información en disco y el audio del perfil del navegador no están cifrados.

## Comprobaciones pendientes antes de la versión estable

El navegador Chromium de este entorno abortó por una restricción de sockets, por lo que `npm run test:ui` no tiene aquí un resultado de aprobación. El flujo con micrófono físico y los lanzadores Windows 11 y Linux Mint necesitan ejecución en esos sistemas. El trabajo de CI de GitHub ejecutará el navegador con micrófono simulado; las pruebas físicas siguen siendo necesarias. No se certifica una reunión de 90 minutos con transcripción completa: depende de memoria, espacio y velocidad del equipo.

## Estado de la candidata

El repositorio `ivan7800/ECHO-404` ya existe y esta corrección parte de su rama `main`. La rama de revisión corrige los mensajes de permisos y aclara que GitHub Pages no ejecuta el servidor Python. Antes de una versión estable, confirmar la prueba de navegador en CI y grabar una toma con micrófono físico en Windows y Linux Mint.
