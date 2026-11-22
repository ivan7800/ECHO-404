# ECHO-404 v1.6.3-rc.1

## Alcance

Candidata de revisión basada en 1.6.2. La grabación conserva el audio en IndexedDB; Whisper local inicia una transcripción automática tras detenerla. TXT, Markdown y DOCX descargan la transcripción. El encabezado del editor confirma el guardado solo cuando SQLite responde; si hay un conflicto o una copia pendiente, lo indica.

## Auditoría y resultados

- Lógica y servidor: `npm run check` y `npm test` (19 pruebas JavaScript y 17 Python) correctos en la preparación de esta RC.
- Inferencia: Whisper real `base` transcribió una muestra de voz sintética; Ollama local `qwen2.5:3b` devolvió acuerdo, tarea, responsable y fecha. Detalles reproducibles en `QA-v1.6.2.md`.
- Distribución: el empaquetador mantiene los lanzadores Windows/Linux y excluye SQLite, audios, modelos y entornos virtuales. Se comprueba el ZIP y el arranque de Linux desde una extracción limpia.
- Seguridad: el servidor escucha en `127.0.0.1`, limita los recursos HTTP, valida origen y revisiones de guardado, y no sirve SQLite. La información en disco y el audio del perfil del navegador no están cifrados.

## Comprobaciones pendientes antes de la versión estable

El navegador Chromium de este entorno abortó por una restricción de sockets, por lo que `npm run test:ui` no tiene aquí un resultado de aprobación. El flujo con micrófono físico y los lanzadores Windows 11 y Linux Mint necesitan ejecución en esos sistemas. El trabajo de CI de GitHub ejecutará el navegador con micrófono simulado; las pruebas físicas siguen siendo necesarias. No se certifica una reunión de 90 minutos con transcripción completa: depende de memoria, espacio y velocidad del equipo.

## Publicación propuesta

El 22 de noviembre se comprobó que `ivan7800/ECHO-404` aún no existe en la cuenta conectada. La CLI local no tiene sesión de GitHub y el navegador de esta sesión pidió iniciar sesión. Por tanto, esta RC está preparada para GitHub, pero todavía no está publicada allí.

Crear un repositorio privado `ivan7800/ECHO-404`, subir esta fuente a la rama `rc/1.6.3`, comprobar que ambos trabajos `Quality` pasan y abrir una PR hacia `main`. Tras probar Windows y Linux Mint con una frase real, publicar la etiqueta `v1.6.3-rc.1` como **prerelease** adjuntando el ZIP generado por `python3 scripts/package.py`. No publicar `echo-404.sqlite3`, `models/`, `.venv-ai/` ni grabaciones.

El paquete de preparación para GitHub incluye `git/ECHO-404-rc.bundle` con dos commits: `main` contiene la fuente 1.6.2 y `rc/1.6.3` contiene esta candidata. Con GitHub CLI autenticada, desde el directorio donde está el bundle:

```bash
git clone git/ECHO-404-rc.bundle ECHO-404
cd ECHO-404
git switch -c main origin/main
git switch rc/1.6.3
git remote remove origin
gh repo create ivan7800/ECHO-404 --private --source=. --remote=origin
git push -u origin main
git push -u origin rc/1.6.3
gh pr create --draft --base main --head rc/1.6.3 --title "ECHO-404 v1.6.3 RC1" --body-file RELEASE-CANDIDATE.md
```

Estos comandos no se han ejecutado contra GitHub en esta auditoría porque el repositorio no existe y `gh` no tiene sesión iniciada.
