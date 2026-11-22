import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, askMeetings, transcriptTimeline } from '../notebook.js';

const minutes = { id: 'lunes', title: 'Seguimiento', notes: '', date: '2026-11-16',
  transcript: 'Punto anterior.  Migración el viernes.\nMigración el viernes.',
  audioId: 'segunda-toma', transcriptAudioId: 'primera-toma',
  segments: [
    { start: 0, end: 1, text: 'Punto anterior.' },
    { start: 2.25, end: 3.4, text: 'Migración el viernes.' },
    { start: 5, end: 6, text: 'Migración el viernes.' }
  ] };

test('all four templates preserve the draft, merge missing headings and tolerate retries', () => {
  for (const [name, heading] of [
    ['Equipo', 'Acuerdos'], ['Soporte técnico', 'Diagnóstico'], ['Entrevista', 'Preguntas'], ['Proyecto', 'Hitos']
  ]) {
    const draft = '  Notas privadas\n## ' + heading + '\nMis apuntes  ';
    const next = applyTemplate(draft, name);
    assert.ok(next.startsWith(draft));
    assert.equal(next.split('## ' + heading).length, 2);
    assert.equal((next.match(/^## /gm) || []).length, 4);
    assert.equal(applyTemplate(next, name), next);
    assert.equal(applyTemplate('', name).startsWith('## '), true);
  }
  assert.equal(applyTemplate('Borrador', 'desconocida'), 'Borrador');
});

test('timestamps refer to exact occurrences and the original recording, including zero seconds', () => {
  const parts = transcriptTimeline(minutes);
  assert.deepEqual(parts.map(p => p.start), [0, 2.25, 5]);
  assert.deepEqual(parts.map(p => p.offset), [0, 17, 39]);
  for (const p of parts) {
    assert.equal(minutes.transcript.slice(p.offset, p.offset + p.quote.length), p.quote);
    assert.equal(p.audioId, 'primera-toma');
  }
  assert.ok(transcriptTimeline({ ...minutes, transcriptAudioId: null }).every(p => p.audioId === null));
});

test('legacy text, stale alignment and invalid timing still yield citable untimed excerpts', () => {
  for (const change of [
    { segments: undefined }, { segments: [] }, { segments: [null] },
    { transcript: 'Nuevo comienzo. Migración el viernes.' },
    { transcript: minutes.transcript + ' Corrección.' },
    ...[NaN, Infinity, -1, '0'].map(start => ({ segments: [{ start, end: 2, text: minutes.transcript }] })),
    { segments: [{ start: 5, end: 2, text: minutes.transcript }] },
    { segments: minutes.segments.map((s, i) => ({ ...s, start: i === 2 ? 1 : s.start })) }
  ]) {
    const m = { ...minutes, ...change };
    assert.deepEqual(transcriptTimeline(m), []);
    const hit = askMeetings([m], '¿Cuándo es la migración?')[0];
    assert.equal(hit.quote, 'Migración el viernes.');
    assert.equal(hit.audioId, undefined);
  }
});

test('cross-meeting answers preserve provenance and diversity, rank coverage, and fold accents', () => {
  const other = { id: 'martes', title: 'Seguimiento', date: '2026-11-17',
    decisions: 'Aprobamos la migracion el viernes con Ana.', summary: 'Ana avisa el jueves.' };
  const hits = askMeetings([minutes, other], '¿La MIGRACIÓN con Ana?', { limit: 2 });
  assert.deepEqual(hits.map(h => [h.meetingId, h.field]), [['martes', 'decisions'], ['lunes', 'transcript']]);
  assert.equal(hits[0].quote, other.decisions);
  assert.deepEqual([hits[1].quote, hits[1].start], ['Migración el viernes.', 2.25]);
  assert.equal(askMeetings([minutes], 'viernes').length, 1);
  for (const q of ['', '¿Qué es?', 'Migr', 'viernes123']) assert.deepEqual(askMeetings([minutes], q), []);
});

test('evidence for a note searches the transcript only and preserves exact text in long paragraphs', () => {
  const transcript = 'Inicio.\n' + 'datos '.repeat(140) + 'El presupuesto es 42.000 euros.';
  const m = { ...minutes, transcript, notes: 'Promesa sin fuente.', summary: 'Promesa sin fuente.' };
  const result = askMeetings([m], 'presupuesto', { transcriptOnly: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].field, 'transcript');
  assert.match(result[0].quote, /42\.000 euros\./);
  assert.equal(transcript.slice(result[0].offset, result[0].offset + result[0].quote.length), result[0].quote);
  assert.deepEqual(askMeetings([m], 'promesa', { transcriptOnly: true }), []);
});
