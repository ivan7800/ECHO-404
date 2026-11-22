export const VERSION = '1.6.4-rc.1';
export const SCHEMA = 'echo-404-v2';
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const emptyState = () => ({ schema: SCHEMA, meetings: [], tasks: [], settings: { language: 'es-ES', autoBackup: true, speechEnabled: false } });
const validId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const str = (value, max = 200000) => typeof value === 'string' ? value.slice(0, max) : '';
const placeholders = /^(La transcripción aparecerá|Este navegador no ofrece reconocimiento)/;

export function normalizeState(input) {
  const raw = input?.data || input;
  if (!raw || !Array.isArray(raw.meetings) || !Array.isArray(raw.tasks)) throw Error('La copia no contiene reuniones y tareas válidas.');
  if (raw.meetings.length > 10000 || raw.tasks.length > 50000) throw Error('La copia supera el límite de registros.');
  const state = emptyState();
  const meetingIds = new Set(), taskIds = new Set();
  for (const m of raw.meetings) {
    if (!m || typeof m.title !== 'string' || typeof m.notes !== 'string') throw Error('Hay una reunión incompleta en la copia.');
    const id = validId(m.id) ? m.id : uid();
    if (meetingIds.has(id)) throw Error('La copia contiene identificadores de reunión repetidos.');
    meetingIds.add(id);
    let notes = str(m.notes), transcript = str(m.transcript);
    if (m.transcript === undefined && notes.includes('\n\nTRANSCRIPCIÓN:\n')) {
      const parts = notes.split('\n\nTRANSCRIPCIÓN:\n'); notes = parts.shift(); transcript = [...new Set(parts)].join('\n');
    }
    if (placeholders.test(transcript)) transcript = '';
    const date = Number.isFinite(Date.parse(m.date)) ? m.date : now();
    state.meetings.push({ id, title: str(m.title, 300) || 'Sin título', notes, transcript,
      summary: str(m.summary), decisions: str(m.decisions), project: str(m.project, 100),
      tags: [...new Set((Array.isArray(m.tags) ? m.tags : []).filter(t => typeof t === 'string').map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20),
      date, updatedAt: Number.isFinite(Date.parse(m.updatedAt)) ? m.updatedAt : date,
      audioId: validId(m.audioId) ? m.audioId : null, duration: Math.max(0, Number(m.duration) || 0) });
  }
  for (const t of raw.tasks) {
    if (!t || typeof t.text !== 'string') throw Error('Hay una tarea incompleta en la copia.');
    const id = validId(t.id) ? t.id : uid();
    if (taskIds.has(id)) throw Error('La copia contiene identificadores de tarea repetidos.');
    taskIds.add(id);
    state.tasks.push({ id, text: str(t.text, 2000), owner: str(t.owner, 100), priority: ['high', 'normal', 'low'].includes(t.priority) ? t.priority : 'normal',
      due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '', status: ['todo', 'doing', 'done'].includes(t.status) ? t.status : t.done ? 'done' : 'todo',
      meetingId: meetingIds.has(t.meetingId) ? t.meetingId : null, updatedAt: t.updatedAt || now() });
  }
  const s = raw.settings || {};
  state.settings = { language: ['es-ES', 'ca-ES', 'en-US'].includes(s.language) ? s.language : 'es-ES', autoBackup: s.autoBackup !== false, speechEnabled: s.speechEnabled === true };
  return state;
}

export function newMeeting() {
  return { id: uid(), title: 'Nueva reunión', notes: '', transcript: '', summary: '', decisions: '', project: '', tags: [], date: now(), updatedAt: now(), audioId: null, duration: 0 };
}
export function meetingMarkdown(m, tasks) {
  const lines = ['# ' + m.title, '', 'Fecha: ' + m.date, 'Proyecto: ' + (m.project || '—'), 'Etiquetas: ' + m.tags.join(', '), '', '## Notas', m.notes, '', '## Transcripción', m.transcript, '', '## Resumen', m.summary, '', '## Decisiones', m.decisions, '', '## Tareas'];
  tasks.filter(t => t.meetingId === m.id).forEach(t => lines.push('- [' + (t.status === 'done' ? 'x' : ' ') + '] ' + t.text + ' · ' + (t.owner || 'Sin responsable') + ' · ' + (t.due || 'Sin fecha')));
  return lines.join('\n');
}

export function extractActions(text) {
  return [...new Set(text.split(/[\n.!?]+/).map(s => s.trim()).filter(s => /\b(revisar|preparar|enviar|comprobar|hacer|pendiente|tarea)\b/i.test(s)))].slice(0, 20);
}
