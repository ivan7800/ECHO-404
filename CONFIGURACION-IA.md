# Voz y actas en ECHO-404 1.6.3 RC2

Puedes tomar notas, grabar y organizar tareas desde el primer arranque. Instala Whisper para transcribir audio y Ollama para obtener un borrador del acta. Cada motor funciona de forma independiente.

## Transcribir con Whisper

1. Extrae el ZIP en una carpeta de tu usuario. Para el motor de voz hemos probado Python 3.12 de 64 bits. La primera instalación descarga paquetes y un modelo multilingüe.
2. En Windows, haz doble clic en `INSTALAR_WHISPER.bat`. En Linux Mint, ejecuta `bash instalar-whisper.sh`. Se crea un entorno Python en `.venv-ai` y se descarga el modelo **base** en `models/whisper-base`. En Mint, si Python indica que falta `ensurepip`, el paquete de la distribución es `python3-venv`.
3. Reinicia ECHO-404 con el lanzador habitual. Abre **Mi reunión → Asistente local**. Si conoces el idioma, selecciona Español, Català o English. También puedes dejar la detección automática.
4. Al detener una toma nueva, ECHO-404 inicia Whisper automáticamente y guarda la transcripción si el texto no ha cambiado durante el proceso. Para una toma anterior pulsa **Usar grabación guardada**; también puedes **Elegir archivo**. Revisa la propuesta y pulsa **Aplicar** en estos dos flujos manuales. **Descargar JSON** conserva el inicio y el fin de cada segmento.

En un portátil con poca memoria puedes probar `bash instalar-whisper.sh tiny` en Linux o `INSTALAR_WHISPER.bat --model tiny` en Windows. Para elegir el modelo de mayor tamaño incluido en el instalador usa `small` en el mismo comando. Reinicia la aplicación tras cambiarlo. También puedes iniciar el servidor con `--whisper-model RUTA` para usar un modelo CTranslate2 compatible que ya tengas.

ECHO-404 procesa un archivo por trabajo, con un máximo de 128 MiB y 90 minutos de audio decodificado. Se probaron WAV, FLAC, MP3, M4A, OGG y WebM. El archivo elegido para transcribir se copia temporalmente al servidor de tu equipo. La grabación original del navegador sigue en IndexedDB. El reconocimiento en vivo del navegador es un ajuste independiente que viene desactivado y puede usar servicios externos.

Una toma del micrófono se cierra automáticamente a los 90 minutos o al alcanzar unos 128 MiB. Descarga el audio al terminar una reunión importante. El espacio disponible del perfil del navegador puede impedir guardarla antes. La transcripción tiene un tiempo máximo de cómputo de 15 minutos, así que aceptar 90 minutos de audio no garantiza poder procesarlos íntegramente en cualquier equipo. Para reuniones largas, usa sesiones más cortas.

En dos muestras cortas de voz sintética en español y catalán, `small` conservó mejor el nombre propio y el lugar que `base`. Aun así, cambió unas palabras al final de la frase en catalán. Para actas en estos idiomas conviene revisar personas, fechas y encargos escuchando el original.

## Generar un acta con Ollama

1. Instala Ollama en tu equipo y abre su aplicación o servicio. Si lo inicias desde una terminal, el comando es `ollama serve`. ECHO-404 consulta el servicio en `127.0.0.1:11434`. [Descargar Ollama](https://ollama.com/download)
2. En otra terminal, descarga una vez el modelo probado con `ollama pull qwen2.5:3b`. Comprueba que aparece al ejecutar `ollama list`. El motor y sus pesos se instalan por separado del ZIP. [Ficha del modelo](https://ollama.com/library/qwen2.5:3b)
3. Añade notas o una transcripción a la reunión. Abre **Asistente local → Comprobar motores**, selecciona el modelo y pulsa **Proponer acta**.
4. Revisa **Resumen**, **Decisiones** y **Tareas propuestas**. Puedes corregir un responsable, ajustar una fecha, eliminar un encargo o añadir uno omitido. **Aplicar** reemplaza el resumen y las decisiones y combina las tareas nuevas con las existentes en esa reunión. Las tareas previas con el mismo texto conservan sus cambios.

El límite es de 20.000 caracteres de notas y transcripción juntos. La aplicación muestra un aviso cuando se supera. Para trabajar por bloques puedes crear reuniones separadas y conservar el original. El motor puede atribuir un encargo a la persona equivocada o confundirlo con una decisión, especialmente con modelos pequeños.

## Estado y recuperación

- Puedes seguir editando durante el proceso. Si cambias los campos utilizados, la aplicación bloquea **Aplicar** para proteger tus cambios. Puedes descargar el resultado o generar otra propuesta.
- Al cerrar la vista previa con × puedes volver a abrirla. **Descartar** libera la propuesta. **Cancelar proceso** interrumpe el trabajo local.
- ECHO-404 permite un trabajo de IA a la vez y conserva en memoria los últimos ocho resultados mientras el servidor siga abierto. Al recargar la misma pestaña puede recuperar la propuesta del motor. Las correcciones hechas en una vista previa pendiente viven en esa página hasta aplicarlas o descargarlas.
- El proceso de IA tiene un límite de 15 minutos. Para Ollama el tiempo de espera de la respuesta del modelo es de cuatro minutos. Un error o una cancelación deja intacto el texto anterior.
- Si quieres usar solo funciones locales de Ollama en versiones con servicios de nube, el servicio admite `OLLAMA_NO_CLOUD=1`. Configúrala en el entorno del servicio y reinícialo. ECHO-404 solicita un modelo instalado y comprueba sus metadatos antes de enviar el texto. [Configuración de Ollama](https://docs.ollama.com/faq)

Implementación de referencia de las dos interfaces. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [API de chat de Ollama](https://docs.ollama.com/api/chat)
