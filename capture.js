// Owned streams are released together on cancel, error, disconnect or stop.
export async function prepareCapture(mode) {
  const streams = [];
  let context;
  function close() {
    for (const {stream} of streams) stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  try {
    if (mode !== 'microphone') {
      const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
      streams.push({label: 'Pestaña', stream});
      if (!stream.getAudioTracks().length) throw Error('Selecciona una pestaña y activa Compartir audio.');
    }
    if (mode !== 'display') {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      streams.push({label: 'Micrófono', stream});
    }
    context = new AudioContext();
    await context.resume();
    const output = context.createMediaStreamDestination();
    const gain = context.createGain();
    gain.gain.value = 1 / streams.length;
    gain.connect(output);
    const levels = streams.map(({label, stream}) => {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(gain);
      const data = new Float32Array(analyser.fftSize);
      return {label, read() {
        analyser.getFloatTimeDomainData(data);
        return Math.min(1, Math.sqrt(data.reduce((sum, n) => sum + n*n, 0) / data.length) * 4);
      }};
    });
    return {stream: output.stream, streams, levels, close, mode};
  } catch (error) {
    close();
    throw error;
  }
}
