# ECHO-404 1.7.0 RC1

La captura de micrófono y pestaña usa Web Audio, con dos medidores antes de grabar. Las tomas se escriben aproximadamente cada cinco segundos y se recuperan desde Ajustes. Al interrumpir una grabación en Chromium de CI se restauraron 965.484 bytes y se decodificaron 60,42 segundos de audio simulado tras exportar y restaurar la copia completa.

## Prueba de Whisper

Con la versión candidata, el servicio HTTP local y pesos multilingües reales, se procesó una muestra sintética en catalán de 5,98 segundos con small en 4,5 segundos. Reprodujo la frase sobre la reunión en Barcelona y el informe de Marta. Un FLAC español de 5.467,57 segundos (1.521.359 bytes) contiene dos intervenciones separadas por silencio. Base tardó 5,1 segundos y confundió el nombre Marta. Small tardó 10,1 segundos, identificó ambas intervenciones, añadió la palabra «entradas» y alcanzó 859.112 KiB de RSS máxima en esta máquina. El PCM temporal ocupó unos 167 MiB. Estos tiempos dependen de que la mayor parte del archivo sea silencio digital. No se midieron 91 minutos de conversación continua ni 91 minutos de grabación de una llamada.

Para reproducir una variante con archivos Opus incluidos en el repositorio, ejecuta con ffmpeg y el Python del entorno de IA:

    python tests/verify_long_whisper.py /ruta/al/modelo/whisper-small

Los archivos de tests/fixtures contienen voz sintética original generada mediante eSpeak. Las pruebas de interfaz simulan el micrófono y la respuesta de reconocimiento; las pruebas de inferencia anteriores ejecutan el modelo. Quality ejecuta Chromium, Firefox y WebKit en tres tamaños, además del arranque de los lanzadores desde una extracción limpia en Windows y Ubuntu. Cada ejecución publica su ZIP en Artifacts.

## Límites de la candidata

Quedan pendientes sesiones con personas, micrófonos físicos y dispositivos Windows 11, Linux Mint, iPhone y iPad, con suspensión e interrupciones reales. En móvil, mantén la página visible para grabar, o importa una toma de la grabadora del sistema. La captura simultánea de micrófono y pestaña depende del selector y permisos del navegador. La captura general del sistema, las aplicaciones móviles nativas y la sincronización con cuentas quedan fuera de esta candidata. El cuaderno busca citas literales para revisar las propuestas. Una coincidencia de palabras no prueba por sí misma un acuerdo.
