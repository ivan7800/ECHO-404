import { taskCalendar } from './calendar.js';
import { prepareCapture } from './capture.js';
import { VERSION, uid, now, newMeeting, normalizeState, emptyState, meetingMarkdown, extractActions } from './model.js';
import { initNotebook } from './notebook.js';
import { Store, audioRecord, beginRecording, appendRecordingChunk, finalizeRecordingDraft, listRecordingDrafts, discardRecordingDraft, exportFullBackup } from './storage.js';
import { setupAI, mergeActions } from './ai-client.js';
import { transcriptFile, transcriptFilename } from './transcript-export.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer, draftTimer, current = newMeeting(), taskEditing = null, taskMeetingId = null;
let recording = null, recognition = null, stopping = false, speechPrefix = '', ready = false;
function microphoneMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return 'Micrófono bloqueado. Permite el micrófono para esta página en el icono de permisos de la barra de direcciones y vuelve a pulsar Grabar.';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'No se detecta ningún micrófono. Conecta uno y comprueba que el sistema lo reconoce.';
    case 'NotReadableError': case 'TrackStartError':
      return 'El micrófono está ocupado o el sistema impide abrirlo. Cierra otras apps que lo usen y comprueba sus permisos.';
    case 'OverconstrainedError': return 'El micrófono no admite los ajustes solicitados.';
    case 'AbortError': return 'La captura se interrumpió. Comprueba el micrófono e inténtalo de nuevo.';
    default: return 'No se pudo iniciar la captura de audio. Comprueba los permisos del navegador y el micrófono.';
  }
}
function audioStatus(message, isError = false) {
  $('audioState').textContent = message;
  $('audioState').classList.toggle('error', isError);
  if (isError) toast(message);
}
const labels = { high: 'Alta', normal: 'Normal', low: 'Baja', todo: 'Pendiente', doing: 'En curso', done: 'Completada' };
let store, updateAI, notebook, opening = false;
store = new Store((text, warning) => {
  $('saveState').textContent = text; $('saveState').classList.toggle('high', !!warning);
  $('conflict').classList.toggle('hidden', !store?.conflict);
  if (ready && !recording && !stopping) $('status').textContent = warning ? text : text === 'Guardado en SQLite' ? 'Guardada' : text;
});

function toast(text) {
  $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function filename() { return (current.title || 'reunion').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 80) || 'reunion'; }
function collect() {
  for (const key of ['title', 'project', 'notes', 'transcript', 'summary', 'decisions']) current[key] = $(key === 'title' ? 'meetingTitle' : key).value;
  current.tags = [...new Set($('tags').value.split(',').map(t => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  return current;
}
function persist(showToast = false) {
  if (!ready) return;
  clearTimeout(draftTimer); collect();
  const content = [current.notes, current.transcript, current.summary, current.decisions, current.project].some(t => t.trim());
  if (!recording && !content && !current.tags.length && !current.audioId && current.title === 'Nueva reunión' && !store.state.meetings.some(m => m.id === current.id)) return;
  current.updatedAt = now();
  const index = store.state.meetings.findIndex(m => m.id === current.id);
  if (index < 0) store.state.meetings.push(structuredClone(current)); else store.state.meetings[index] = structuredClone(current);
  store.save();
  try { localStorage.setItem('echo404-current', current.id); } catch {}
  $('status').textContent = recording ? 'Grabando' : 'Guardando…'; renderLists();
  if (showToast) toast('Guardando reunión…');
}
function renderEditor() {
  for (const key of ['title', 'project', 'notes', 'transcript', 'summary', 'decisions']) $(key === 'title' ? 'meetingTitle' : key).value = current[key] || '';
  $('tags').value = current.tags.join(', ');
  $('status').textContent = store.conflict ? 'Conflicto de guardado' : store.pending ? 'Pendiente de sincronizar' : store.state.meetings.some(m => m.id === current.id) ? 'Guardada' : 'Borrador';
  $('timer').textContent = formatTime(current.duration); audioStatus(current.audioId ? 'Audio disponible en este navegador' : 'Listo para grabar');
  $('downloadAudio').classList.toggle('hidden', !current.audioId); $('speechState').textContent = '';
  void renderAudioLibrary();
  notebook?.refresh();
  renderMeetingTasks();
  updateAI?.();
}
function formatTime(seconds = 0) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(x => String(x).padStart(2, '0')).join(':');
}
function audioExtension(type) {
  if (type.includes('mp4')) return '.m4a';
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('mpeg')) return '.mp3';
  if (type.includes('wav')) return '.wav';
  if (type.includes('flac')) return '.flac';
  if (type.includes('aac')) return '.aac';
  return '.webm';
}
function show(view) {
  document.querySelectorAll('.view').forEach(n => { n.hidden = n.id !== view; });
  document.querySelectorAll('[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $('pageTitle').textContent = { dashboard: 'Mi reunión', meetings: 'Biblioteca', tasks: 'Tareas', settings: 'Ajustes' }[view];
  renderLists();
}
function taskRows(tasks) {
  if (!tasks.length) return '<p class="empty">Todo despejado. Añade el siguiente paso cuando lo necesites.</p>';
  const today = new Date().toLocaleDateString('sv-SE');
  return tasks.map(t => {
    const meeting = store.state.meetings.find(m => m.id === t.meetingId);
    const overdue = t.due && t.due < today && t.status !== 'done';
    return '<div class="task-row"><input type="checkbox" data-done="' + esc(t.id) + '" aria-label="Completar: ' + esc(t.text) + '" ' + (t.status === 'done' ? 'checked' : '') + '><div class="task-content ' + (t.status === 'done' ? 'done' : '') + '"><strong>' + esc(t.text) + '</strong><div class="chips"><span>' + esc(t.owner || 'Sin responsable') + '</span><span class="' + (t.priority === 'high' ? 'high' : '') + '">· ' + labels[t.priority] + '</span><span>· ' + labels[t.status] + '</span>' + (t.due ? '<span class="' + (overdue ? 'overdue' : '') + '">· ' + esc(t.due) + (overdue ? ' · Vencida' : '') + '</span>' : '') + '</div>' + (meeting ? '<span class="hint">' + esc(meeting.title) + '</span>' : '') + '</div><button data-edit-task="' + esc(t.id) + '">Editar</button></div>';
  }).join('');
}
function renderMeetingTasks() { $('meetingTasks').innerHTML = taskRows(store.state.tasks.filter(t => t.meetingId === current.id)); }
function fillFilter(id, values, label) {
  const select = $(id), selected = select.value;
  select.replaceChildren(new Option(label, ''), ...values.map(value => new Option(value, value)));
  if (values.includes(selected)) select.value = selected;
}
function renderLists() {
  $('meetingCount').textContent = store.state.meetings.length;
  $('taskCount').textContent = store.state.tasks.filter(t => t.status !== 'done').length;
  fillFilter('projectFilter', [...new Set(store.state.meetings.map(m => m.project).filter(Boolean))].sort(), 'Todos');
  fillFilter('tagFilter', [...new Set(store.state.meetings.flatMap(m => m.tags))].sort(), 'Todas');
  const query = $('search').value.toLocaleLowerCase(), project = $('projectFilter').value, tag = $('tagFilter').value;
  const meetings = store.state.meetings.filter(m => (!project || m.project === project) && (!tag || m.tags.includes(tag)) && [m.title, m.notes, m.transcript, m.summary, m.decisions, m.project, ...m.tags].join(' ').toLocaleLowerCase().includes(query)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  $('libraryCount').textContent = meetings.length + ' reuniones';
  $('meetingList').innerHTML = meetings.map(m => '<article class="meeting-row"><div><h3>' + esc(m.title) + '</h3><p>' + esc((m.summary || m.notes || m.transcript || 'Sin notas todavía').slice(0, 180)) + '</p><div class="chips"><span>' + esc(new Date(m.date).toLocaleDateString('es-ES')) + '</span>' + (m.project ? '<span>· ' + esc(m.project) + '</span>' : '') + m.tags.map(t => '<span class="badge">' + esc(t) + '</span>').join('') + '</div></div><div><button data-open="' + esc(m.id) + '">Abrir</button></div></article>').join('') || '<p class="empty">No hay reuniones que coincidan con estos filtros.</p>';
  const tq = $('taskSearch').value.toLocaleLowerCase(), status = $('taskStatus').value, priority = $('taskPriority').value;
  const tasks = store.state.tasks.filter(t => (!status || t.status === status) && (!priority || t.priority === priority) && (t.text + ' ' + t.owner).toLocaleLowerCase().includes(tq));
  $('tasksList').innerHTML = taskRows(tasks); renderMeetingTasks();
}
function openTask(id = null, meetingId = null) {
  persist(); taskEditing = id; const task = store.state.tasks.find(t => t.id === id); taskMeetingId = task?.meetingId || meetingId;
  $('taskDialogTitle').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  $('taskText').value = task?.text || ''; $('taskOwner').value = task?.owner || ''; $('taskDue').value = task?.due || '';
  $('taskFormStatus').value = task?.status || 'todo'; $('taskFormPriority').value = task?.priority || 'normal';
  $('deleteTask').classList.toggle('hidden', !task);
  const meeting = store.state.meetings.find(m => m.id === taskMeetingId);
  $('taskMeetingLabel').textContent = meeting ? 'Reunión: ' + meeting.title : 'Tarea independiente';
  $('taskDialog').showModal(); $('taskText').focus();
}
function saveTask(event) {
  event.preventDefault(); const text = $('taskText').value.trim(); if (!text) return;
  const task = { id: taskEditing || uid(), text, owner: $('taskOwner').value.trim(), due: $('taskDue').value, priority: $('taskFormPriority').value, status: $('taskFormStatus').value, meetingId: taskMeetingId, updatedAt: now() };
  const index = store.state.tasks.findIndex(t => t.id === task.id);
  if (index < 0) store.state.tasks.push(task); else store.state.tasks[index] = task;
  store.save(); renderLists(); $('taskDialog').close(); toast('Tarea guardada');
}
function organize() {
  collect(); const text = [current.notes, current.transcript].filter(Boolean).join('\n');
  if (!text.trim()) { toast('Añade notas o una transcripción'); return; }
  persist(); let added = 0;
  for (const action of extractActions(text)) {
    if (!store.state.tasks.some(t => t.meetingId === current.id && t.text.toLocaleLowerCase() === action.toLocaleLowerCase())) {
      store.state.tasks.push({ id: uid(), text: action, owner: '', due: '', priority: 'normal', status: 'todo', meetingId: current.id, updatedAt: now() }); added++;
    }
  }
  if (!current.summary.trim()) { current.summary = text.slice(0, 800); $('summary').value = current.summary; }
  persist(); renderLists(); toast(added + ' acciones detectadas. Resumen por extracción; revisa el contenido.');
}
async function exportMeeting() {
  persist(); const tasks = store.state.tasks.filter(t => t.meetingId === current.id), type = $('exportFormat').value;
  let content = meetingMarkdown(current, store.state.tasks), mime = 'text/markdown';
  if (type === 'ics') {
    try { download(new Blob([taskCalendar(current,tasks)], {type:'text/calendar;charset=utf-8'}), filename() + '.ics'); }
    catch (error) { toast(error.message); }
    return;
  }
  if (type === 'docx' || type === 'txt') {
    try { download(await transcriptFile(content, current.title, type), filename() + '.' + type); }
    catch (error) { toast(error.message); }
    return;
  }
  if (type === 'json') { content = JSON.stringify({ schema: 'echo-404-meeting-v2', meeting: current, tasks }, null, 2); mime = 'application/json'; }
  if (type === 'html') { content = '<!doctype html><html lang="es"><meta charset="utf-8"><title>' + esc(current.title) + '</title><body><h1>' + esc(current.title) + '</h1><pre>' + esc(content) + '</pre></body></html>'; mime = 'text/html'; }
  download(new Blob([content], { type: mime + ';charset=utf-8' }), filename() + '.' + type);
}
function exportBackup() {
  persist(); download(new Blob([JSON.stringify({ ...store.state, exportedAt: now(), appVersion: VERSION }, null, 2)], { type: 'application/json' }), 'echo-404-backup.json');
}
function applyImported(raw) {
  const imported = normalizeState(raw.state || raw);
  if (!confirm('¿Reemplazar reuniones y tareas por esta copia? Los audios permanecen en este navegador.')) return;
  store.backup(); clearTimeout(draftTimer); store.state = imported; store.save(); current = newMeeting(); renderEditor(); renderLists(); renderSettings(); toast('Copia restaurada');
}
function renderSettings() {
  $('language').value = store.state.settings.language; $('autoBackup').checked = store.state.settings.autoBackup;
  $('speechEnabled').checked = store.state.settings.speechEnabled;
}
function stopSpeech() {
  const sr = recognition; recognition = null;
  if (sr) { sr.onend = null; try { sr.stop(); } catch {} }
}
function startSpeech() {
  if (!store.state.settings.speechEnabled) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('speechState').textContent = 'Este navegador no admite transcripción en directo. Descarga el audio y usa Whisper con el lanzador local.'; $('transcriptTab').click(); return; }
  speechPrefix = $('transcript').value;
  const sr = new SR(); recognition = sr; sr.lang = store.state.settings.language; sr.continuous = true; sr.interimResults = false;
  $('transcriptTab').click();
  $('speechState').textContent = 'Escuchando · el texto aparecerá aquí al reconocer frases completas.';
  sr.onresult = event => {
    let full = ''; for (let i = 0; i < event.results.length; i++) if (event.results[i].isFinal) full += event.results[i][0].transcript + ' ';
    $('transcript').value = [speechPrefix, full.trim()].filter(Boolean).join('\n'); persist();
    $('speechState').textContent = 'Transcripción en directo · guardando texto en esta reunión.';
  };
  sr.onerror = event => { $('speechState').textContent = 'Reconocimiento de voz: ' + event.error + '. El audio continúa grabándose.'; if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) recognition = null; };
  sr.onend = () => { if (recording && !stopping && recognition === sr) { speechPrefix = $('transcript').value; try { sr.start(); } catch {} } };
  try { sr.start(); } catch { $('speechState').textContent = 'No se pudo iniciar el reconocimiento. El audio sigue activo.'; }
}
function elapsed(session) {
  return Math.max(0, Math.floor(((session.pausedAt ?? performance.now()) - session.started - session.pausedMs) / 1000));
}
async function lockCapture() {
  if (!navigator.locks) throw Object.assign(Error('Este navegador necesita Web Locks para proteger las tomas. Abre la aplicación en un navegador actualizado y HTTPS.'), {name: 'CaptureBusy'});
  let acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  const request = navigator.locks.request('echo404-audio-operation', {ifAvailable: true}, lock => {
    if (!lock) { acquired(null); return; }
    return new Promise(resolve => acquired(resolve));
  });
  const release = await Promise.race([ready, request]);
  if (!release) throw Object.assign(Error('Hay otra operación de audio en curso. Detén la otra pestaña y reintenta.'), {name: 'CaptureBusy'});
  return release;
}
async function toggleRecording(source = 'microphone', prepared = null) {
  if (stopping || opening) return;
  if (recording) {
    stopping = true; $('record').disabled = true; $('status').textContent = 'Guardando audio';
    stopSpeech();
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
    else await finalizeRecording(recording);
    return;
  }
  if (!window.isSecureContext) { audioStatus('Abre ECHO-404 en HTTPS o en localhost para permitir el micrófono.', true); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { audioStatus('Este navegador no ofrece captura de audio. Prueba Chrome o Edge actualizado.', true); return; }
  if (source === 'display' && !navigator.mediaDevices.getDisplayMedia) { audioStatus('Este navegador no permite compartir audio de pestaña.', true); return; }
  if (source === 'microphone' && location.hostname.endsWith('.github.io') && !store.state.settings.speechEnabled) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && confirm('Para ver la transcripción en GitHub Pages se usa el reconocimiento del navegador. Puede enviar tu voz a su proveedor y requiere Internet. ¿Activarlo para esta reunión y las siguientes?')) {
      store.state.settings.speechEnabled = true; store.save(); renderSettings();
    } else if (!SR) {
      $('speechState').textContent = 'Este navegador no admite transcripción en directo. El audio se guardará para usarlo con Whisper local.';
      $('transcriptTab').click();
    }
  }
  opening = true;
  $('record').disabled = true; $('recordTab').disabled = true;
  let stream, displayStream, release, draftId;
  try {
    audioStatus(source === 'display' ? 'Elige una pestaña y activa «Compartir audio»…' : 'Solicitando permiso de micrófono…');
    if (prepared) stream = prepared.stream;
    else if (source === 'display') {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (!displayStream.getAudioTracks().length) throw Object.assign(Error('Sin audio compartido'), { name: 'NoDisplayAudio' });
      stream = new MediaStream(displayStream.getAudioTracks());
    } else stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    release = await lockCapture();
    collect();
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported?.(type));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    draftId = await beginRecording(current.id, recorder.mimeType, source);
    const session = { id: draftId, release, seq: 0, writes: Promise.resolve(), recorder, prepared, source, pausedAt: null, pausedMs: 0, stream, displayStream, bytes: 0, meetingId: current.id, started: performance.now(), timer: null };
    recording = session;
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      const seq = session.seq++;
      const duration = elapsed(session);
      session.bytes += event.data.size;
      session.writes = session.writes.then(async () => {
        if (session.writeError) return;
        try { await appendRecordingChunk(session.id, seq, event.data, duration); }
        catch (error) {
          session.writeError = error;
          if (!stopping && recording === session) void toggleRecording();
        }
      });
    };
    recorder.onerror = event => { audioStatus('Error de grabación. Intentando conservar el audio disponible.', true); if (recorder.state !== 'inactive') recorder.stop(); else finalizeRecording(session); };
    recorder.onstop = () => finalizeRecording(session);
    for (const track of [...stream.getAudioTracks(), ...(prepared?.streams.flatMap(input => input.stream.getTracks()) || [])]) track.addEventListener('ended', () => {
      if (recording === session && !stopping) {
        toast('El micrófono se desconectó. Guardando el audio recibido.');
        void toggleRecording();
      }
    });
    for (const track of displayStream?.getVideoTracks() || []) track.addEventListener('ended', () => { if (recording === session && !stopping) void toggleRecording(); });
    recorder.start(5000); $('pauseCapture').hidden = false; if (prepared) showLevels(prepared, $('liveLevels')); $('record').textContent = 'Detener'; $('recordDot').classList.add('live'); $('recordDot').closest('.recbar').classList.add('recording'); $('status').textContent = 'Grabando';
    audioStatus(source === 'mixed' ? 'Micrófono y pestaña activos · grabando' : source === 'display' ? 'Audio de pestaña activo · grabando' : 'Micrófono activo · grabando'); $('newMeeting').disabled = true;
    session.timer = setInterval(() => {
      current.duration = Math.floor(((session.pausedAt ?? performance.now()) - session.started - session.pausedMs) / 1000);
      $('timer').textContent = formatTime(current.duration);

    }, 250);
    persist();
    if (source !== 'microphone') { $('transcriptTab').click(); $('speechState').textContent = 'El audio de la pestaña se transcribe al detener con Whisper local. El dictado del navegador solo escucha el micrófono.'; }
    else startSpeech();
  } catch (error) {
    release?.(); if (draftId) await discardRecordingDraft(draftId).catch(() => {});
    prepared?.close(); stream?.getTracks().forEach(track => track.stop()); displayStream?.getTracks().forEach(track => track.stop()); recording = null;
    audioStatus(error.name === 'NoDisplayAudio' ? 'No se compartió audio. Selecciona una pestaña y marca «Compartir audio».' : error.name === 'CaptureBusy' || error.name === 'QuotaExceededError' ? error.message : microphoneMessage(error), true);
  } finally { opening = false; $('record').disabled = false; if (!recording) $('recordTab').disabled = false; }
}
async function finalizeRecording(session) {
  if (session.finalizing) return; session.finalizing = true; stopping = true;
  clearInterval(session.timer); clearInterval(levelTimer); $('liveLevels').replaceChildren(); $('pauseCapture').hidden = true; $('pauseCapture').textContent = 'Pausar'; session.prepared?.close(); stopSpeech(); session.stream.getTracks().forEach(t => t.stop()); session.displayStream?.getTracks().forEach(t => t.stop());
  let recordingSaved = false;
  try {
    await session.writes;
    if (session.writeError) throw session.writeError;
    const record = await finalizeRecordingDraft(session.id);
    recordingSaved = true;
    current.audioId = record.id; current.duration = record.duration;
    $('downloadAudio').classList.remove('hidden'); $('audioState').textContent = 'Audio guardado en este navegador'; toast('Grabación guardada');
    void renderAudioLibrary();
  } catch (error) {
    audioStatus('Guardado interrumpido. Revisa el espacio y pulsa Recuperar tomas para conservar los fragmentos escritos.', true);
  } finally {
    session.release();
    recording = null; stopping = false; $('record').disabled = false; $('record').textContent = 'Grabar otra toma';
    $('newMeeting').disabled = false; $('recordTab').disabled = false; $('recordDot').classList.remove('live'); $('recordDot').closest('.recbar').classList.remove('recording'); persist();
    updateAI?.();
    if (current.audioId && recordingSaved) void updateAI?.transcribeSaved();
  }
}
async function renderAudioLibrary() {
  const meetingId = current.id, container = $('recordingLibrary');
  try {
    const recordings = (await audioRecord('list', meetingId)).sort((a, b) => b.createdAt - a.createdAt);
    if (meetingId !== current.id) return;
    container.replaceChildren();
    if (!recordings.length) return;
    const heading = document.createElement('p'); heading.textContent = 'Tomas guardadas en este navegador'; container.append(heading);
    for (const item of recordings) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Descargar · ' + (item.source ? ({microphone:'Micrófono',display:'Pestaña',mixed:'Mezcla'}[item.source] || 'Audio') + ' · ' : '') + formatTime(item.duration || 0) + ' · ' + new Date(item.createdAt).toLocaleString('es-ES') + ' · ' + (item.blob.size / 1048576).toFixed(1) + ' MiB';
      button.onclick = () => download(item.blob, filename() + '-' + item.id.slice(0, 8) + audioExtension(item.blob.type));
      container.append(button);
    }
  } catch { container.textContent = 'No se pueden leer las tomas guardadas en este navegador.'; }
}
async function downloadAudio() {
  try {
    const record = await audioRecord('get', current.audioId);
    if (!record?.blob) { toast('El audio está en el navegador donde se grabó. La copia JSON no lo incluye.'); return; }
    download(record.blob, filename() + audioExtension(record.blob.type));
  } catch { toast('No se pudo leer el audio'); }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('echo404-theme', theme); } catch {}
  $('themeToggle').setAttribute('aria-label', theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro');
  $('themeToggle').querySelector('span').textContent = theme === 'light' ? 'Modo claro' : 'Modo oscuro';
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f4f5f1' : '#111518';
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { persist(); show(button.dataset.view); });
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) {
    if (opening || recording || stopping) { toast('Detén la grabación antes de cambiar de reunión'); return; }
    persist(); current = structuredClone(store.state.meetings.find(m => m.id === open.dataset.open)); renderEditor(); show('dashboard');
  }
  const edit = event.target.closest('[data-edit-task]'); if (edit) openTask(edit.dataset.editTask);
});
document.addEventListener('change', event => {
  if (!event.target.dataset.done) return;
  const task = store.state.tasks.find(t => t.id === event.target.dataset.done);
  if (task) { task.status = event.target.checked ? 'done' : 'todo'; task.updatedAt = now(); store.save(); renderLists(); }
});
for (const id of ['meetingTitle', 'notes', 'transcript', 'summary', 'decisions', 'project', 'tags']) $(id).addEventListener('input', () => {
  clearTimeout(draftTimer); draftTimer = setTimeout(() => persist(), 550); $('status').textContent = 'Edición en curso';
});
for (const id of ['search', 'projectFilter', 'tagFilter', 'taskSearch', 'taskStatus', 'taskPriority']) $(id).addEventListener(id.includes('Filter') || ['taskStatus', 'taskPriority'].includes(id) ? 'change' : 'input', renderLists);
$('newMeeting').onclick = () => { if (opening || recording || stopping) return; persist(); current = newMeeting(); renderEditor(); show('dashboard'); };
$('saveMeeting').onclick = () => persist(true); $('summarize').onclick = organize; $('export').onclick = exportMeeting;
$('addMeetingTask').onclick = () => { persist(); if (!store.state.meetings.some(m => m.id === current.id)) { current.title = 'Reunión sin título'; $('meetingTitle').value = current.title; persist(); } openTask(null, current.id); };
$('addTask').onclick = () => openTask(); $('taskForm').onsubmit = saveTask;
for (const id of ['closeTask', 'cancelTask']) $(id).onclick = () => $('taskDialog').close();
$('deleteTask').onclick = () => { if (confirm('¿Eliminar esta tarea?')) { store.state.tasks = store.state.tasks.filter(t => t.id !== taskEditing); store.save(); renderLists(); $('taskDialog').close(); } };
let preparedCapture = null, preparation = 0, levelTimer;
function showLevels(capture, container) {
  clearInterval(levelTimer);
  container.replaceChildren();
  const meters = capture.levels.map(level => {
    const label = document.createElement('label'), meter = document.createElement('meter');
    meter.max = 1; label.append(level.label + ' ', meter); container.append(label);
    return () => { meter.value = level.read(); };
  });
  levelTimer = setInterval(() => meters.forEach(update => update()), 100);
}
$('prepareCapture').onclick = async () => {
  if (opening || recording || stopping) return;
  const serial = ++preparation;
  $('captureDialog').showModal(); $('startPrepared').disabled = true;
  $('prepareState').textContent = 'Autoriza las fuentes para ver sus niveles.';
  try {
    const capture = await prepareCapture($('captureMode').value);
    if (serial !== preparation) { capture.close(); return; }
    preparedCapture = capture;
    showLevels(capture, $('prepareLevels'));
    $('prepareState').textContent = 'Habla y reproduce sonido en la pestaña seleccionada. Comprueba los niveles antes de grabar.';
    $('startPrepared').disabled = false;
  } catch (error) {
    if (serial === preparation) $('prepareState').textContent = error.name === 'NotAllowedError' ? 'Permiso denegado. Revisa los permisos y vuelve a elegir las fuentes.' : error.message;
  }
};
$('cancelPrepared').onclick = () => $('captureDialog').close();
$('captureDialog').onclose = () => {
  preparation++; preparedCapture?.close(); preparedCapture = null;
  if (!recording) clearInterval(levelTimer);
  $('prepareLevels').replaceChildren();
};
$('startPrepared').onclick = () => {
  const capture = preparedCapture;
  if (!capture) return;
  preparedCapture = null; $('captureDialog').close();
  void toggleRecording(capture.mode, capture);
};
$('pauseCapture').onclick = () => {
  const session = recording;
  if (!session || stopping) return;
  if (session.recorder.state === 'recording') {
    session.recorder.pause(); session.pausedAt = performance.now(); stopSpeech();
    $('pauseCapture').textContent = 'Reanudar'; audioStatus('Grabación en pausa');
  } else if (session.recorder.state === 'paused') {
    session.recorder.resume(); session.pausedMs += performance.now() - session.pausedAt;
    session.pausedAt = null; $('pauseCapture').textContent = 'Pausar'; audioStatus('Grabación activa');
    if (session.source === 'microphone') startSpeech();
  }
};
$('record').onclick = () => toggleRecording(); $('recordTab').onclick = () => toggleRecording('display'); $('downloadAudio').onclick = downloadAudio;
$('downloadTranscript').onclick = async () => {
  const text = $('transcript').value, format = $('transcriptFormat').value;
  try {
    const blob = await transcriptFile(text, $('meetingTitle').value, format);
    download(blob, transcriptFilename($('meetingTitle').value, format));
  } catch (error) { toast(error.message); }
};
for (const tab of ['notes', 'transcript']) $(tab + 'Tab').onclick = () => {
  for (const name of ['notes', 'transcript']) { $(name + 'Panel').hidden = name !== tab; $(name + 'Tab').classList.toggle('active', name === tab); $(name + 'Tab').setAttribute('aria-selected', String(name === tab)); }
};
$('language').onchange = () => { store.state.settings.language = $('language').value; store.save(); };
$('autoBackup').onchange = () => { store.state.settings.autoBackup = $('autoBackup').checked; store.save(); };
$('speechEnabled').onchange = () => { store.state.settings.speechEnabled = $('speechEnabled').checked; store.save(); if (!$('speechEnabled').checked) stopSpeech(); };
$('themeToggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
async function exclusiveAudio(action) {
  let release;
  try { release = await lockCapture(); await action(); }
  catch (error) { toast(error.message); }
  finally { release?.(); }
}
$('recoverTakes').onclick = () => exclusiveAudio(async () => {
  const drafts = await listRecordingDrafts();
  if (!drafts.length) { toast('No hay tomas interrumpidas'); return; }
  for (const draft of drafts) {
    if (!draft.count) { await discardRecordingDraft(draft.id); continue; }
    const take = await finalizeRecordingDraft(draft.id, 'recuperada');
    let target = store.state.meetings.find(m => m.id === take.meetingId);
    if (!target) {
      target = {...newMeeting(), id:take.meetingId, title:'Reunión recuperada'};
      store.state.meetings.push(target);
    }
    target.audioId = take.id; target.duration = take.duration;
    if (current.id === target.id) { current.audioId = take.id; current.duration = take.duration; }
    store.save();
  }
  renderEditor(); renderLists(); toast('Recuperación terminada. Consulta las tomas en la reunión.');
});
$('importTake').onchange = event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  void exclusiveAudio(async () => {
    if (!file.size || file.size > 256 * 1024 * 1024) throw Error('Elige un archivo de audio de hasta 256 MiB.');
    const target = current, id = uid(), probe = document.createElement('audio');
    const url = URL.createObjectURL(file);
    try {
      const duration = await new Promise((resolve,reject) => {
        const fail = () => { clearTimeout(timer); reject(Error('El navegador no pudo leer la pista de audio. Prueba WAV, MP3 o M4A.')); };
        const timer = setTimeout(fail,10000);
        probe.onloadedmetadata = () => { clearTimeout(timer); resolve(Number.isFinite(probe.duration) ? probe.duration : 0); };
        probe.onerror = fail; probe.src = url;
      });
      if (target !== current) throw Error('La reunión cambió. Selecciona otra vez el archivo.');
      await audioRecord('put', {id, meetingId:target.id, source:'archivo', size:file.size, duration, status:'guardada', createdAt:Date.now(), blob:file});
      target.audioId = id; target.duration = Math.floor(duration);
      if (target === current) { persist(); renderEditor(); void updateAI?.transcribeSaved(); }
      else { const saved = store.state.meetings.find(m => m.id === target.id); if (saved) { saved.audioId = id; store.save(); } }
    } finally { probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); }
  });
};
$('fullExport').onclick = () => exclusiveAudio(async () => {
  persist(); download(await exportFullBackup(store.state), 'echo-404-completa.echo');
});
$('fullRestore').onchange = event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || !confirm('¿Reemplazar reuniones, tareas y audio con esta copia completa?')) return;
  void exclusiveAudio(async () => {
    clearTimeout(draftTimer); await store.restoreFullBackup(file);
    current = structuredClone(store.state.meetings.at(-1) || newMeeting());
    renderEditor(); renderLists(); renderSettings(); toast('Copia completa restaurada');
  });
};
$('backupExport').onclick = exportBackup; $('conflictExport').onclick = exportBackup;
$('backupImportButton').onclick = () => { if (opening || recording || stopping) { toast('Detén la grabación antes de importar'); return; } $('backupImport').click(); };
$('backupImport').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 8 * 1024 * 1024) throw Error('La copia supera 8 MiB'); applyImported(JSON.parse(await file.text())); }
  catch (error) { toast(error.message || 'Copia no válida'); } finally { event.target.value = ''; }
};
$('restoreBackup').onclick = () => {
  if (opening || recording || stopping) { toast('Detén la grabación antes de restaurar'); return; }
  try { const backup = JSON.parse(localStorage.getItem('echo404-last-backup') || 'null'); if (!backup) throw Error('Aún no hay copia local'); applyImported(backup); } catch (error) { toast(error.message); }
};
$('clearData').onclick = async () => {
  if (opening || recording || stopping) { toast('Detén la grabación antes de vaciar'); return; }
  if (!confirm('¿Vaciar reuniones, tareas y audio de este espacio? Descarga una copia antes de continuar.')) return;
  await exclusiveAudio(async () => {
    if (store.conflict || store.busy || (store.revision !== null && !store.connected)) throw Error('Reconecta SQLite y resuelve los conflictos antes de vaciar.');
    const blank = emptyState();
    if (store.connected) {
      const response = await fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json','X-Echo-Client':'echo-404'},
        body:JSON.stringify({expectedRevision:store.revision,state:blank,purgeHistory:true})});
      if (!response.ok) throw Error('SQLite no confirmó el borrado. Comprueba la conexión y la revisión.');
      store.revision = (await response.json()).revision;
    }
    clearTimeout(draftTimer); clearTimeout(store.timer);
    store.state = blank; store.pending = false; store.cache(); current = newMeeting();
    renderEditor(); renderSettings(); renderLists();
    for (const key of ['echo404-data','echo404-last-backup','echo404-before-conflict','echo404-current']) localStorage.removeItem(key);
    sessionStorage.removeItem('echo404-ai-ticket-1');
    await audioRecord('clear'); toast('Espacio vaciado');
  });
};
async function reconnect() {
  if (store.busy) { toast('Espera a que termine el guardado'); return; }
  persist(); await store.connect(); renderLists(); renderSettings();
}
$('retrySync').onclick = reconnect;
$('conflictReload').onclick = async () => {
  if (opening || recording || stopping) { toast('Detén la grabación antes de cargar otros datos'); return; }
  try { clearTimeout(draftTimer); await store.useServer(); current = newMeeting(); renderEditor(); renderLists(); renderSettings(); }
  catch (error) { toast(error.message); }
};
window.addEventListener('beforeunload', event => { persist(); store.backup(); if (opening || recording || stopping) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', reconnect);
setInterval(() => store.backup(), 60000);

async function boot() {
  document.querySelectorAll('main button, main input, main textarea, main select').forEach(n => { n.disabled = true; });
  await store.connect();
  const lastId = (() => { try { return localStorage.getItem('echo404-current'); } catch { return null; } })();
  current = structuredClone(store.state.meetings.find(m => m.id === lastId) || store.state.meetings.at(-1) || newMeeting());
  ready = true; renderEditor(); renderSettings(); renderLists(); applyTheme(document.documentElement.dataset.theme);
  if (store.recovered) toast('Se ha recuperado la última copia local válida');
  document.querySelectorAll('main button, main input, main textarea, main select').forEach(n => { n.disabled = false; });
  notebook = initNotebook({meeting: collect, meetings: () => store.state.meetings, audio: async id => (await audioRecord('get', id))?.blob});
  updateAI = setupAI({
    meeting: collect,
    blocked: () => !!recording || stopping || store.conflict,
    audio: async id => id ? (await audioRecord('get', id))?.blob : null,
    download,
    onTranscriptStatus: text => { $('audioState').textContent = text; },
    apply(kind, proposal) {
      collect();
      if (kind === 'transcription') {
        current.segments = proposal.segments || [];
        current.transcriptAudioId = proposal.transcriptAudioId || null;
        $('transcript').value = proposal.text;
        collect(); notebook.refresh();
        $('transcriptTab').click();
      } else {
        $('summary').value = proposal.summary;
        $('decisions').value = proposal.decisions.join('\n');
        store.state.tasks.push(...mergeActions(store.state.tasks, current.id, proposal.tasks));
      }
      persist();
    }
  });
  setInterval(() => { try { localStorage.setItem('echo404-current', current.id); } catch {} }, 1000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(registration => registration.update()).catch(() => {});
}
boot().catch(error => { $('saveState').textContent = 'Error al abrir: ' + error.message; });

