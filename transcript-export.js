export function transcriptFilename(title, extension) {
  const safe = (title || 'reunion').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 70) || 'reunion';
  return safe + '-transcripcion.' + extension;
}

export async function transcriptFile(text, title, format, fetcher = fetch) {
  if (!text.trim()) throw Error('La transcripción está vacía.');
  if (format === 'txt') return new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (format === 'md') {
    const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
    return new Blob(['# Transcripción · ' + cleanTitle + '\n\n' + text + '\n'], { type: 'text/markdown;charset=utf-8' });
  }
  if (format !== 'docx') throw Error('Formato de transcripción desconocido.');
  const response = await fetcher('/api/export/docx', {
    method: 'POST',
    headers: { 'X-Echo-Client': 'echo-404', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, text })
  });
  if (!response.ok) throw Error('No se pudo crear el DOCX. Comprueba que el servidor está abierto.');
  return response.blob();
}
