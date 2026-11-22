# ECHO-404 · 1.7.0 RC1

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
- La grabación escribe fragmentos en IndexedDB aproximadamente cada cinco segundos. Ajustes → Recuperar tomas interrumpidas conserva los fragmentos que alcanzaron el disco. El espacio disponible y las políticas de suspensión del dispositivo limitan la duración.
- Reconocimiento de voz opcional del navegador, desactivado inicialmente. Puede necesitar Internet y enviar voz al proveedor del navegador. No equivale a Whisper local.
- «Organizar notas» propone acciones por palabras clave y un extracto editable. No usa un modelo de IA ni asigna automáticamente responsables.
- Copias JSON de texto y tareas, importación validada de formatos anteriores y recuperación de última copia local. Las copias JSON no incluyen audio.
- Caché de recursos para modo offline, excluyendo las rutas de API. SQLite requiere el servidor en ejecución.

## Micrófono en GitHub Pages

Abre `https://ivan7800.github.io/ECHO-404/` en Chrome, Edge o Firefox, conecta un micrófono y pulsa **Iniciar grabación**. El navegador solicita permiso si todavía no lo concediste o bloqueaste. Si el acceso está bloqueado, cambia el permiso de micrófono en el icono situado junto a la dirección y vuelve a intentarlo. Si no hay dispositivo, conecta uno y comprueba los permisos del sistema. GitHub Pages ofrece transcripción en directo cuando el navegador admite SpeechRecognition y aceptas activarlo; puede enviar voz al proveedor del navegador y requiere conexión. El texto aparece en la pestaña Transcripción. Descarga el audio al terminar: GitHub Pages guarda datos en ese navegador y perfil, sin SQLite ni Whisper. Para transcripción automática y guardado en SQLite, usa los lanzadores del paquete local e instala Whisper. El reconocimiento de voz del navegador es opcional y distinto de la grabación.

## Instrucciones por dispositivo

### Windows 11 y Linux Mint

1. Descarga el ZIP generado por `python3 scripts/package.py`, extráelo completo y abre el lanzador correspondiente. El navegador abrirá `http://127.0.0.1:4173/`.
2. En **Preparar audio y comprobar niveles**, selecciona **Micrófono y pestaña** si necesitas ambos lados de una llamada web. Selecciona la pestaña, activa **Compartir audio**, concede permiso al micrófono y comprueba ambos medidores. Pulsa **Grabar reunión**. Durante una pausa puedes seguir tomando notas.
3. Pulsa **Detener**, espera a que aparezca la toma en **Tomas guardadas** y descarga una copia. La última toma se transcribe automáticamente solo si Whisper está instalado y el servidor local está abierto. Usa **Asistente local** para revisar la propuesta y generar el acta con Ollama si lo instalaste.
4. Consulta la transcripción y el cuaderno, revisa el acta y exporta. **Ajustes → Descargar copia con audio** crea un archivo .echo que puedes restaurar en otro perfil o equipo. El JSON antiguo contiene solo texto y tareas.

### iPhone, iPad y Android

Abre GitHub Pages en el navegador y concede acceso al micrófono. La transcripción en directo depende de que el navegador admita `SpeechRecognition`; puede usar un servicio externo y requiere aceptación. Mantén la página en primer plano mientras grabas: el bloqueo de pantalla puede suspender el navegador. Detén y descarga cada toma. GitHub Pages no ejecuta Whisper, Ollama ni SQLite. Para transcribir audio guardado con Whisper, pásalo al ordenador y ábrelo en **Asistente local**. La captura de pestaña está pensada para escritorio.

### Límites verificados

La matriz de navegadores usa equipos virtuales y audio simulado. Consulta RELEASE-CANDIDATE.md para las medidas de recuperación y las pruebas con modelos reales.

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

Para llamadas de escritorio, la captura actual admite las fuentes que ofrece el navegador. La captura general de otras aplicaciones requiere una entrada de monitor del sistema o un capturador nativo. En móvil, puedes importar un archivo de la grabadora del dispositivo. Las copias .echo permiten traslado manual. El calendario admite exportación ICS de tareas con fecha. La sincronización automática y el etiquetado automático de voces siguen pendientes.
