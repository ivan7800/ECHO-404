import { uid, now } from './model.js';
import { transcriptFile, transcriptFilename } from './transcript-export.js';

const $ = id => document.getElementById(id);
const key = 'echo404-ai-ticket-1';
const summaryText = m => [m.notes.trim(), m.transcript.trim()].filter(Boolean).join('\n\n');

// Compare only fields used by the job or overwritten on apply. Edits to a title
// or an unrelated task should not invalidate a proposal.
export function baseline(kind, m, savedAudio = false) {
  const fields = kind === 'summary' ? ['notes', 'transcript', 'summary', 'decisions'] : ['transcript'];
  if (savedAudio) fields.push('audioId');
  return Object.fromEntries(['id', ...fields].map(field => [field, m[field]]));
}
export function matchesBaseline(source, meeting) {
  return Object.entries(source).every(([field, value]) => value === meeting[field]);
}
export function mergeActions(tasks, meetingId, proposed) {
  const normalize = s => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  const existing = new Set(tasks.filter(t => t.meetingId === meetingId).map(t => normalize(t.text)));
  const added = [];
  for (const item of proposed) {
    const label = normalize(item.text);
    if (!label || existing.has(label)) continue;
    added.push({ id: uid(), text: item.text, owner: item.owner, due: item.due, priority: 'normal', status: 'todo', meetingId, updatedAt: now() });
    existing.add(label);
  }
  return added;
}
function transcriptPreview(proposal) {
  return proposal.segments.map(s => {
    const seconds = Math.floor(s.start);
    return '[' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + '] ' + s.text;
  }).join('\n') || proposal.text || 'Sin voz detectada.';
}
function taskDraft(task) {
  const row = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Tarea';
  row.append(legend);
  for (const [name, title, type, max] of [['text', 'Acción', 'text', 2000], ['owner', 'Responsable', 'text', 100], ['due', 'Fecha límite', 'date', 10]]) {
    const label = document.createElement('label'), input = document.createElement('input');
    label.textContent = title; input.name = name; input.type = type; input.maxLength = max; input.value = task[name] || '';
    label.append(input); row.append(label);
  }
  const remove = document.createElement('button');
  remove.textContent = 'Quitar tarea'; remove.onclick = () => row.remove(); row.append(remove);
  return row;
}
async function request(path, method = 'GET', body, mime = 'application/json') {
  const headers = method === 'GET' ? {} : { 'X-Echo-Client': 'echo-404', 'Content-Type': mime };
  const response = await fetch('./api/ai/' + path, { method, body, headers, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || ('Error del servidor (' + response.status + ')')), { status: response.status });
  return data;
}
export function setupAI({ meeting, audio, blocked, apply, download, onTranscriptStatus = () => {} }) {
  let ticket = null, proposal = null, draftLoaded = false, submitting = false, probing = false, timer;
  let status = null, cancelling = false;
  const message = text => { $('aiMessage').textContent = text; };
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved?.id && saved.source?.id && ['summary', 'transcription'].includes(saved.kind)) ticket = saved;
  } catch {}
  function remember() {
    try {
      if (ticket) sessionStorage.setItem(key, JSON.stringify(ticket));
      else sessionStorage.removeItem(key);
    } catch {}
  }
  function buttons() {
    const busy = submitting || !!ticket;
    $('aiChoose').disabled = busy || !status?.whisper.ready;
    $('aiRecording').disabled = $('aiChoose').disabled || !meeting().audioId;
    $('aiSummary').disabled = busy || !status?.ollama.models.length;
    $('aiModel').disabled = $('aiSummary').disabled;
    $('aiRefresh').disabled = probing;
    $('aiCancel').hidden = !ticket || !!proposal;
    $('aiCancel').disabled = cancelling;
    $('aiReview').hidden = !proposal;
  }
  async function probe() {
    if (probing) return;
    probing = true;
    buttons();
    try {
      status = await request('status');
      $('whisperStatus').textContent = status.whisper.ready ? 'Whisper preparado · hasta 3 horas y 256 MiB por archivo.' : 'Para activar Whisper, ejecuta el instalador incluido y reinicia ECHO-404.';
      $('ollamaStatus').textContent = status.ollama.models.length ? 'Genera una propuesta a partir de tus notas y transcripción.' :
        status.ollama.available ? 'Descarga un modelo local en Ollama y pulsa Comprobar motores.' : 'Inicia Ollama en este equipo para generar actas con IA.';
      let model = $('aiModel').value;
      if (!model) { try { model = localStorage.getItem('echo404-ollama-model'); } catch {} }
      $('aiModel').replaceChildren(...(status.ollama.models.length ? status.ollama.models : ['Sin modelos disponibles']).map(m => new Option(m, m)));
      if (status.ollama.models.includes(model)) $('aiModel').value = model;
      else if (status.ollama.models.includes('qwen2.5:3b')) $('aiModel').value = 'qwen2.5:3b';
    } catch {
      status = null;
      $('whisperStatus').textContent = $('ollamaStatus').textContent = 'Abre ECHO-404 con su lanzador y comprueba la conexión.';
    } finally { probing = false; buttons(); }
  }
  function clear() {
    clearTimeout(timer); ticket = null; proposal = null; draftLoaded = false; cancelling = false; remember(); buttons();
  }
  async function poll() {
    const id = ticket?.id;
    if (!id) return;
    try {
      const job = await request('jobs/' + encodeURIComponent(id));
      if (ticket?.id !== id) return;
      if (job.state === 'done') {
        proposal = job.result;
        if (ticket.kind === 'transcription') proposal.transcriptAudioId = ticket.source.audioId || null;
        buttons();
        if (ticket.autoApply) {
          if (proposal.text?.trim() && applicable()) {
            apply('transcription', proposal);
            clear();
            message('Transcripción guardada en la reunión. Puedes descargarla en TXT, MD o DOCX.');
            onTranscriptStatus('Transcripción guardada · abre la pestaña Transcripción');
            return;
          }
          onTranscriptStatus(proposal.text?.trim() ? 'Audio guardado · revisa la propuesta antes de aplicarla' : 'Audio guardado · Whisper no detectó voz');
        }
        message('Propuesta lista para «' + ticket.title + '». Revísala antes de guardarla.');
        return;
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        if (ticket.autoApply) onTranscriptStatus('Audio guardado · transcripción fallida: ' + (job.error?.message || 'proceso cancelado'));
        clear(); message(job.error?.message || 'Proceso cancelado.'); return;
      }
      message(job.state === 'cancelling' ? 'Cancelando…' : Number.isFinite(job.progress) ? 'Whisper local · ' + job.progress + ' %' : 'Procesando en este equipo…');
    } catch (error) {
      if (error.status === 404) { clear(); message('La propuesta ha caducado. Puedes generarla de nuevo.'); return; }
      message('Esperando la conexión con el servidor local…');
    }
    timer = setTimeout(poll, 1100);
  }
  async function start(kind, file = null, autoApply = false) {
    if (submitting || ticket) return;
    if (blocked()) { message('Termina la grabación o resuelve el conflicto de guardado antes de continuar.'); return; }
    submitting = true; buttons();
    try {
      const m = meeting(), source = baseline(kind, m, kind === 'transcription' && !file), title = m.title;
      let job;
      if (kind === 'transcription') {
        const blob = file || await audio(m.audioId);
        if (!blob?.size) throw Error('Selecciona un archivo o guarda una grabación en este navegador.');
        if (blob.size > status.maxAudioBytes) throw Error('El audio supera 256 MiB.');
        job = await request('transcriptions?language=' + $('aiLanguage').value, 'POST', blob, 'application/octet-stream');
      } else {
        const text = summaryText(m);
        if (!text || [...text].length > status.maxSummaryChars) throw Error('El acta admite entre 1 y 20.000 caracteres de notas y transcripción.');
        job = await request('summaries', 'POST', JSON.stringify({ text, model: $('aiModel').value }));
      }
      ticket = { id: job.id, kind, source, title, autoApply }; remember(); message(Number.isFinite(job.progress) ? 'Whisper local · ' + job.progress + ' %' : 'Procesando en este equipo…'); void poll();
    } catch (error) {
      message(error.message);
      if (autoApply) onTranscriptStatus('Audio guardado · transcripción no iniciada: ' + error.message);
    }
    finally { submitting = false; buttons(); }
  }
  function applicable() {
    return !!proposal && !blocked() && matchesBaseline(ticket.source, meeting()) &&
      (ticket.kind !== 'transcription' || !!proposal.text.trim());
  }
  function review() {
    $('aiTitle').textContent = ticket.kind === 'summary' ? 'Revisar acta' : 'Revisar transcripción';
    $('aiTranscriptDownload').hidden = ticket.kind !== 'transcription';
    $('aiTranscriptFormatLabel').hidden = ticket.kind !== 'transcription';
    $('aiTarget').textContent = ticket.title + ' · ' + (proposal.model || 'Whisper');
    const isSummary = ticket.kind === 'summary';
    $('aiPreview').hidden = isSummary;
    $('aiEdit').hidden = !isSummary;
    if (isSummary && !draftLoaded) {
      $('aiSummaryDraft').value = proposal.summary;
      $('aiDecisionsDraft').value = proposal.decisions.join('\n');
      $('aiDraftTasks').replaceChildren(...proposal.tasks.map(taskDraft));
      draftLoaded = true;
    } else if (!isSummary) $('aiPreview').textContent = transcriptPreview(proposal);
    $('aiApply').disabled = !applicable();
    $('aiEffect').textContent = ticket.kind === 'transcription' && !proposal.text.trim() ? 'Whisper no detectó voz. Se conserva tu transcripción.' :
      $('aiApply').disabled ? 'Para aplicar, abre la reunión de origen con su contenido original y termina cualquier grabación. Puedes descargar la propuesta.' :
      ticket.kind === 'summary' ? 'Aplicar sustituye el resumen y las decisiones, y añade las tareas nuevas.' : 'Aplicar sustituye la transcripción. El JSON incluye las marcas de tiempo.';
    $('aiDialog').showModal();
  }
  function edited() {
    if (ticket.kind !== 'summary') return proposal;
    const tasks = Array.from($('aiDraftTasks').children, row =>
      Object.fromEntries(Array.from(row.querySelectorAll('input'), i => [i.name, i.value.trim()]))).filter(t => t.text);
    return { ...proposal, summary: $('aiSummaryDraft').value.trim(), decisions: $('aiDecisionsDraft').value.split('\n').map(s => s.trim()).filter(Boolean), tasks };
  }
  $('aiAddDraft').onclick = () => {
    const row = taskDraft({});
    $('aiDraftTasks').append(row);
    row.querySelector('input').focus();
  };
  $('aiTools').ontoggle = () => { if ($('aiTools').open && !status) void probe(); };
  $('aiRefresh').onclick = probe;
  $('aiModel').onchange = () => { try { localStorage.setItem('echo404-ollama-model', $('aiModel').value); } catch {} };
  $('aiChoose').onclick = () => $('aiFile').click();
  $('aiFile').onchange = () => { const file = $('aiFile').files[0]; $('aiFile').value = ''; if (file) void start('transcription', file); };
  $('aiRecording').onclick = () => start('transcription');
  $('aiSummary').onclick = () => start('summary');
  $('aiCancel').onclick = async () => {
    if (!ticket || proposal) return;
    cancelling = true; buttons();
    try { await request('jobs/' + ticket.id, 'DELETE'); }
    catch (error) { message(error.message); }
    finally { cancelling = false; buttons(); }
  };
  $('aiClose').onclick = () => $('aiDialog').close();
  $('aiReview').onclick = review;
  $('aiDiscard').onclick = () => { $('aiDialog').close(); clear(); message('Propuesta descartada.'); };
  $('aiDownload').onclick = () => download(new Blob([JSON.stringify(edited(), null, 2)], { type: 'application/json' }), 'echo404-' + ticket.kind + '.json');
  $('aiTranscriptDownload').onclick = async () => {
    try {
      const format = $('aiTranscriptFormat').value;
      const blob = await transcriptFile(proposal.text, ticket.title, format);
      download(blob, transcriptFilename(ticket.title, format));
    } catch (error) { message(error.message); }
  };
  async function transcribeSaved() {
    if (ticket || submitting) {
      onTranscriptStatus('Audio guardado · espera al proceso de IA en curso');
      return;
    }
    if (!status?.whisper.ready) await probe();
    if (!status?.whisper.ready) {
      onTranscriptStatus('Audio guardado · instala Whisper para generar texto; puedes descargar el audio');
      return;
    }
    onTranscriptStatus('Audio guardado · transcribiendo con Whisper…');
    await start('transcription', null, true);
  }
  $('aiApply').onclick = () => {
    if (!applicable()) { $('aiApply').disabled = true; $('aiEffect').textContent = 'El contenido ha cambiado. Puedes descargar la propuesta.'; return; }
    apply(ticket.kind, edited()); $('aiDialog').close(); clear(); message('Propuesta aplicada a la reunión.');
  };
  buttons();
  if (ticket) { $('aiTools').open = true; void poll(); }
  return Object.assign(buttons, { transcribeSaved });
}
