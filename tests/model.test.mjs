import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeState, meetingMarkdown, extractActions, newMeeting } from '../model.js';

test('migrates legacy transcript once and ignores instructional placeholder', () => {
  const state = normalizeState({ meetings: [{ id: 'legacy', title: 'Test', notes: 'Nota\n\nTRANSCRIPCIÓN:\nVoz\n\nTRANSCRIPCIÓN:\nVoz', date: '2026-11-20' }], tasks: [{ text: 'Revisar', done: true }] });
  assert.equal(state.meetings[0].notes, 'Nota'); assert.equal(state.meetings[0].transcript, 'Voz'); assert.equal(state.tasks[0].status, 'done');
  const m = { ...state.meetings[0], transcript: 'La transcripción aparecerá aquí cuando el navegador detecte voz.' };
  assert.equal(normalizeState({ ...state, meetings: [m] }).meetings[0].transcript, '');
});
test('accepts both older JSON backup wrappers', () => {
  const state = emptyState(); state.meetings.push(newMeeting());
  assert.equal(normalizeState({ schema: 'echo-404-v1', data: state }).meetings.length, 1);
  assert.deepEqual(normalizeState(state).settings, state.settings);
});
test('rejects invalid records before they reach rendering', () => {
  assert.throws(() => normalizeState({ meetings: [{ title: 'Broken' }], tasks: [] }));
  assert.throws(() => normalizeState({ meetings: [], tasks: [null] }));
});
test('normalizes ids, tags, priority and missing settings', () => {
  const m = { ...newMeeting(), id: "x');alert(1)//", tags: [' soporte ', 'soporte', null] };
  const s = normalizeState({ meetings: [m], tasks: [{ text: 'Review', priority: 'urgent' }] });
  assert.match(s.meetings[0].id, /^[\w-]+$/); assert.deepEqual(s.meetings[0].tags, ['soporte']); assert.equal(s.tasks[0].priority, 'normal');
});
test('rejects duplicate identifiers', () => {
  const m = newMeeting(); assert.throws(() => normalizeState({ meetings: [m, m], tasks: [] }));
});
test('exports only linked tasks and keeps decisions, owner and deadline', () => {
  const m = { ...newMeeting(), decisions: 'Aprobado' };
  const md = meetingMarkdown(m, [{ meetingId: m.id, text: 'Enviar informe', status: 'todo', owner: 'I. Roig', due: '2026-11-23' }, { meetingId: 'other', text: 'Privado' }]);
  assert.match(md, /Aprobado/); assert.match(md, /I. Roig/); assert.match(md, /2026-11-23/); assert.doesNotMatch(md, /Privado/);
});
test('extracts distinct actions without creating tasks from empty text', () => {
  assert.deepEqual(extractActions(''), []); assert.deepEqual(extractActions('Revisar VPN. Revisar VPN. Contexto'), ['Revisar VPN']);
});
