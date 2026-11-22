import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline, matchesBaseline, mergeActions } from '../ai-client.js';
import { newMeeting } from '../model.js';

test('a proposal cannot overwrite edits or be applied to a different meeting', () => {
  const m = newMeeting(), source = baseline('summary', m);
  for (const field of ['id', 'notes', 'transcript', 'summary', 'decisions']) {
    assert.equal(matchesBaseline(source, { ...m, [field]: 'cambio' }), false);
  }
  assert.equal(matchesBaseline(source, { ...m, title: 'Título final' }), true);
});

test('a saved recording proposal tracks its source audio and existing transcript', () => {
  const m = newMeeting();
  assert.equal(matchesBaseline(baseline('transcription', m, true), { ...m, audioId: 'otra' }), false);
  assert.equal(matchesBaseline(baseline('transcription', m), { ...m, audioId: 'otra' }), true);
  assert.equal(matchesBaseline(baseline('transcription', m), { ...m, transcript: 'Corrección' }), false);
});

test('applying tasks preserves edited tasks and deduplicates only within the meeting', () => {
  const proposed = [{ text: 'Enviar informe', owner: 'Ana', due: '2026-12-01' }, { text: 'Enviar  informe', owner: '', due: '' }];
  const existing = [{ meetingId: 'm2', text: 'enviar informe' }];
  const result = mergeActions(existing, 'm1', proposed);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0].owner, result[0].due, result[0].meetingId], ['Ana', '2026-12-01', 'm1']);
  assert.deepEqual(mergeActions([...existing, ...result], 'm1', proposed), []);
  assert.equal(existing.length, 1);
});
