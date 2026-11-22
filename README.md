# ECHO-404 · 1.6.3 RC1

Espacio personal para reuniones, notas, decisiones y tareas. La interfaz Command Center coloca la grabación, las notas y los acuerdos en un mismo espacio de trabajo. Incluye temas claro y oscuro. Python guarda el texto en SQLite. Si instalas los motores opcionales, puedes transcribir audio con Whisper y proponer un acta con Ollama en tu equipo.

## Abrir

Extrae el ZIP completo en una carpeta de tu usuario. Necesitas Python 3.9 o posterior y un navegador moderno.
Esta es una release candidate. El estado de validación y los pasos para GitHub están en `RELEASE-CANDIDATE.md`.

- Windows: doble clic en `INICIAR_ECHO-404.bat`.
- Linux: `bash iniciar-echo-404.sh`. Opcionalmente `chmod +x iniciar-echo-404.sh` y luego `./iniciar-echo-404.sh`.
- Alternativa: `python3 server.py --open` (Windows: `py -3 server.py --open`).

Abre `http://127.0.0.1:4173/`. Mantén la consola abierta y usa Ctrl+C para detener el servidor. No requiere administrador, Node.js ni cambios de ExecutionPolicy. El archivo PowerShell es opcional y respeta la política del equipo.

Si el puerto está ocupado, cierra el servidor anterior o ejecuta `python3 server.py --port 4174 --open`. Un puerto diferente crea un espacio de navegador diferente: el texto de SQLite puede recuperarse, pero el audio de IndexedDB permanece asociado al puerto original. Usa siempre el mismo navegador, perfil y dirección.

## Funciones

- Tema claro y oscuro con preferencia persistente y elección inicial según el sistema.
- Al detener una grabación, el audio se guarda en el navegador y, si Whisper está instalado, se transcribe automáticamente y se guarda el texto en la reunión. La pestaña Transcripción permite descargar TXT, MD o DOCX. Si cambias el texto mientras se procesa, se conserva tu edición y puedes revisar la propuesta.
- En **Mi reunión → Asistente local** también puedes transcribir una toma guardada o elegir un archivo manualmente. El JSON de la propuesta conserva las marcas de tiempo.
- Genera un acta a partir de las notas y la transcripción. En la propuesta puedes corregir el resumen, modificar decisiones y añadir, quitar o editar tareas antes de guardar. Cada tarea admite responsable y fecha. El asistente detecta si ha cambiado la reunión desde el inicio del trabajo.
- Reuniones con título, proyecto, etiquetas, notas, transcripción separada, resumen y decisiones editables.
- La pestaña Transcripción descarga el texto en TXT, Markdown o Word DOCX. Las transcripciones manuales de archivos se revisan y aplican desde Asistente local; una toma nueva se aplica al terminar cuando la reunión no ha cambiado.
- Guardado automático del texto, además de botón Guardar.
- Tareas vinculadas o independientes: responsable, prioridad, fecha límite y estado.
- Edición y finalización de tareas; filtros por estado, prioridad y responsable mediante la búsqueda.
- Biblioteca con búsqueda en todo el contenido, proyecto y etiquetas.
- Exportación por reunión en Markdown, JSON y HTML; incluye decisiones y tareas.
- Grabación de micrófono con `MediaRecorder`; última toma asociada a la reunión y conservada en IndexedDB. Descargar el audio antes de limpiar el navegador.
- Cada toma se detiene automáticamente a los 90 minutos o al alcanzar 128 MiB. La capacidad real depende del almacenamiento disponible en el navegador. El proceso de transcripción dispone de 15 minutos de cómputo, por lo que un audio largo puede agotar ese tiempo antes de producir el texto.
- Reconocimiento de voz opcional del navegador, desactivado inicialmente. Puede necesitar Internet y enviar voz al proveedor del navegador. No equivale a Whisper local.
- «Organizar notas» propone acciones por palabras clave y un extracto editable. No usa un modelo de IA ni asigna automáticamente responsables.
- Copias JSON de texto y tareas, importación validada de formatos anteriores y recuperación de última copia local. Las copias JSON no incluyen audio.
- Caché de recursos para modo offline, excluyendo las rutas de API. SQLite requiere el servidor en ejecución.

## Dónde se guardan los datos

`echo-404.sqlite3`, junto a `server.py`, contiene el estado completo de reuniones, tareas y preferencias. Las tablas de versiones antiguas se conservan durante la migración. En cada guardado se comprueba una revisión: un cambio simultáneo en otra ventana activa el aviso de conflicto y conserva la copia local pendiente.

El navegador conserva una copia del texto para fallos de conexión y los audios en IndexedDB. Las grabaciones no se transfieren a SQLite. Las últimas diez versiones de texto se conservan internamente en SQLite cuando la copia automática está activada; para una copia externa usa Descargar copia JSON y descarga los audios aparte.

No se sirve la base SQLite ni archivos arbitrarios de la carpeta por HTTP. La API se limita a loopback y valida origen, cabecera de cliente y revisiones. Esto no cifra la información del disco.

## Actualizar desde 1.0–1.4

1. Exporta la copia JSON y descarga los audios que quieras conservar en la versión anterior.
2. Detén el servidor anterior.
3. Extrae esta versión en una carpeta nueva. Si quieres migrar SQLite, copia `echo-404.sqlite3` de la carpeta anterior con el servidor detenido. Conserva el original como respaldo.
4. Abre siempre `http://127.0.0.1:4173/` con el mismo navegador y perfil.
5. Si aparece un conflicto entre los datos del navegador y los de SQLite, descarga primero tu copia. Después carga la versión del servidor e importa la copia que hayas elegido conservar.

Los formatos de backup anteriores, tanto `{data: ...}` como el objeto directo, se aceptan y se migran. Si la interfaz parece antigua, recarga con Ctrl+F5; la nueva caché descarta las versiones anteriores.

## API

- `GET /api/health`: estado y versión.
- `GET /api/state`: estado completo y revisión.
- `PUT /api/state`: `{expectedRevision, state}` con cabeceras `Content-Type: application/json` y `X-Echo-Client: echo-404`; responde 409 si otra ventana guardó antes.
- `GET /api/meetings`: lectura de compatibilidad.
- `GET /api/ai/status` consulta los motores disponibles. `POST /api/ai/transcriptions?language=auto` acepta audio binario. `POST /api/ai/summaries` acepta JSON con `model` y `text`. Ambos devuelven 202 y un identificador.
- `GET /api/ai/jobs/{id}` permite consultar el estado y el resultado. `DELETE /api/ai/jobs/{id}` solicita la cancelación. Las operaciones de escritura requieren la cabecera de cliente, y DELETE requiere además el tipo JSON.

## Verificación

Con Node.js instalado: `npm run check` y `npm test`. No hay dependencias necesarias para usar la aplicación. La suite de navegador opcional requiere Playwright: instala `playwright` en tu entorno de desarrollo y su Chromium; después ejecuta `npm run test:ui`. Puedes seleccionar un Chromium instalado con `ECHO_CHROMIUM`.

Consulta `RELEASE-CANDIDATE.md` para los resultados y límites de esta versión y `CONFIGURACION-IA.md` para instalar los motores opcionales.

## Pendientes de producto

Para una llamada por Teams o Meet, ECHO-404 admite archivos de audio que ya tengas y graba el micrófono seleccionado por el navegador. La captura directa del audio del sistema y la identificación de hablantes quedan pendientes. El almacenamiento y las tareas pertenecen a un único equipo. La distribución usa lanzadores y requiere Python.
