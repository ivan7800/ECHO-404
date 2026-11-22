import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptFile, transcriptFilename } from '../transcript-export.js';

test('exports transcript text and markdown with safe filenames', async () => {
  assert.equal(await (await transcriptFile('Voz de prueba', 'Soporte', 'txt')).text(), 'Voz de prueba');
  assert.match(await (await transcriptFile('Línea uno', 'Reunión', 'md')).text(), /^# Transcripción · Reunión\n\nLínea uno/);
  assert.equal(transcriptFilename('Reunión: VPN?', 'docx'), 'Reunión VPN-transcripcion.docx');
  await assert.rejects(() => transcriptFile(' ', 'Vacía', 'txt'), /vacía/);
});

test('Word export contains valid XML, Unicode and complete paragraphs offline', async () => {
  const file = await transcriptFile('Acción & <agenda>\nBon dia 🎙', 'Reunión', 'docx');
  const verifier = `
import io, sys, zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
    assert z.testzip() is None
    for name in z.namelist():
        ET.fromstring(z.read(name))
    doc = ET.fromstring(z.read('word/document.xml'))
    print('|'.join(n.text for n in doc.iter() if n.tag.endswith('}t')))
`;
  const run = spawnSync('python3', ['-c',verifier], {input:Buffer.from(await file.arrayBuffer())});
  assert.equal(run.status, 0, run.stderr.toString());
  assert.equal(run.stdout.toString().trim(),'Reunión|Acción & <agenda>|Bon dia 🎙');
});
