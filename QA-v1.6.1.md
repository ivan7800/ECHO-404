# ECHO-404 1.6.1 · Exportación de transcripciones

El problema se debía a que «Exportar» guardaba la reunión completa en MD, JSON o HTML. La vista previa de Whisper solo descargaba JSON. No había una acción para guardar la transcripción independiente en TXT, MD o DOCX.

La pestaña Transcripción permite descargar el texto editado en los tres formatos. La vista previa de Whisper permite descargar cualquiera de los tres formatos directamente. El DOCX se genera con Python local y no requiere otra biblioteca.

Se verificó que el DOCX contiene el texto y escapa los caracteres XML. Las pruebas de JavaScript comprueban TXT, MD, el nombre del archivo y la petición DOCX. `npm run check` pasó y `npm test` completó 18 pruebas de JavaScript y 17 pruebas de Python sin errores. La ruta que guarda reuniones sigue funcionando.

La prueba de interfaz `npm run test:ui` está añadida para comprobar las tres descargas, pero no se pudo ejecutar aquí porque falta el ejecutable de Chromium de Playwright. En un equipo con Playwright y Chromium instalados puede ejecutarse con `npm run test:ui`.
