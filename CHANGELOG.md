# Cambios

## 1.6.3-rc.3

- GitHub Pages ofrece transcripción visible durante la grabación usando el reconocimiento del navegador, previa aceptación expresa. Puede requerir Internet y enviar voz a su proveedor.
- El texto reconocido se guarda en la reunión; cuando el navegador no admite esta función, se informa y conserva el audio para Whisper local.

## 1.6.3-rc.2

- El indicador de SQLite pasa a «Guardando…» en cuanto cambia el contenido y solo confirma después de recibir respuesta del servidor.
- Grabación: mensaje visible mientras se solicita permiso y diagnóstico específico para micrófono bloqueado, ausente u ocupado.
- La interfaz explica el funcionamiento local de GitHub Pages y cuándo se requiere el servidor para Whisper y SQLite.
- Actualiza la caché de la aplicación para entregar estos cambios.

## 1.6.3-rc.1

- El estado de guardado espera la confirmación de SQLite y muestra los conflictos o copias pendientes.
- El lanzador PowerShell verifica Python 3.9+ y usa el ejecutable alternativo si el primero no sirve.
- Preparación de release candidate con pruebas de CI, exclusión de datos locales y registro de riesgos de plataforma.

## 1.6.2

- La grabación inicia la transcripción al detenerse si Whisper está instalado y aplica el texto automáticamente cuando la reunión no ha cambiado.
- El estado junto al grabador explica cuándo falta Whisper, se está transcribiendo o falla el procesamiento; el audio queda disponible para descargar.
- Verificación con motores locales reales y pruebas específicas del flujo automático.

## 1.6.1

- Añadida descarga de la transcripción sola en TXT, Markdown y DOCX desde la pestaña Transcripción y desde la vista previa de Whisper.
- Añadida descarga TXT desde la vista previa de Whisper antes de aplicar la propuesta.
- Corregido el enlace de descarga para navegadores que requieren un elemento anclado al documento.

## 1.6.0

- Rediseño Command Center con jerarquía visual de sesión, barra de grabación protagonista, navegación lateral mejorada y paneles diferenciados para resumen, decisiones y tareas.
- Temas claro y oscuro actualizados con contraste, acentos y superficies propias.
- Indicadores de audio animados durante la captura y adaptación del panel a móvil y tablet.

## 1.5.1

- La grabación se detiene a los 90 minutos o cuando alcanza aproximadamente 128 MiB. Si se desconecta el micrófono, intenta guardar lo recibido.
- El botón de tema indica el modo activo. Se comprueba el cambio de tema y el corte automático de la grabación.
- Se aclara que la transcripción de audios largos depende del tiempo de procesamiento y del almacenamiento disponible.

## 1.5.0

- Whisper local para archivos de audio y grabaciones guardadas. Selección de idioma, marcas de tiempo y exportación JSON.
- Actas con modelos instalados en Ollama. Revisión y edición de tareas, decisiones y resumen antes de aplicar.
- Procesos cancelables, detección de cambios en la reunión de origen y recuperación de propuestas al recargar la pestaña.
- Instaladores opcionales de Whisper para Windows y Linux. El servidor y el editor funcionan por separado de los modelos.
- Corrección de compatibilidad del decodificador y pruebas con audio, modelos y SQLite reales. Detalles en `QA-v1.5.0.md`.

## 1.4.0

- Panel de reunión con proyecto, etiquetas, resumen y decisiones editables.
- Guardado automático y transcripción almacenada como campo separado.
- Tareas completas con responsable, prioridad, fecha y estado; edición, finalización y búsqueda.
- Biblioteca filtrable por proyecto, etiqueta y texto de decisiones/transcripción.
- Exportación de la reunión en Markdown, JSON y HTML con tareas vinculadas.
- Estado íntegro en SQLite y protección por revisión contra sobrescrituras simultáneas.
- Migración de JSON y SQLite antiguos. Se conservan tablas anteriores.
- Reorganización en módulos de modelo, almacenamiento y aplicación.
- Diseño unificado con variables de color: tarjetas y controles cambian en ambos temas; navegación móvil disponible.
- Grabación asociada a una reunión estable, bloqueo de cambio de reunión durante la toma y descarga del audio con su tipo real.
- Reconocimiento de voz opcional desactivado al iniciar; corrección del texto acumulado.
- Caché PWA de recursos, excluyendo API, con limpieza de versiones anteriores.
- Servidor restringido a recursos de la app, control de origen/host y CSP sin scripts inline.
- Lanzadores en primer plano: al detener el proceso no queda un servidor separado del BAT.
- 19 pruebas aprobadas de lógica, almacenamiento, API y migración. Suite visual incluida pero bloqueada por el entorno; véase QA-v1.4.0.md.
