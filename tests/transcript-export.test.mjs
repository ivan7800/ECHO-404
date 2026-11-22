import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptFile, transcriptFilename } from '../transcript-export.js';

test('exports transcript text and markdown with safe filenames', async () => {
  assert.equal(await (await transcriptFile('Voz de prueba', 'Soporte', 'txt')).text(), 'Voz de prueba');
  assert.match(await (await transcriptFile('Línea uno', 'Reunión', 'md')).text(), /^# Transcripción · Reunión\n\nLínea uno/);
  assert.equal(transcriptFilename('Reunión: VPN?', 'docx'), 'Reunión VPN-transcripcion.docx');
  await assert.rejects(() => transcriptFile(' ', 'Vacía', 'txt'), /vacía/);
});

test('requests Word document with the transcript, without replacing meeting data', async () => {
  const mock = async (path, init) => {
    assert.equal(path, '/api/export/docx');
    assert.equal(init.headers['X-Echo-Client'], 'echo-404');
    assert.deepEqual(JSON.parse(init.body), { title: 'Soporte', text: 'Línea con acento' });
    return { ok: true, blob: async () => new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) };
  };
  assert.equal((await transcriptFile('Línea con acento', 'Soporte', 'docx', mock)).type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
