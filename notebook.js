// The notebook reads live meeting snapshots. Only explicit template/citation actions
// write to the notes textarea, through the editor's existing input/autosave path.
const templates = new Map([
  ['Equipo', ['Ronda del equipo', 'Bloqueos', 'Acuerdos', 'Próximos pasos']],
  ['Soporte técnico', ['Incidencia', 'Entorno y síntomas', 'Diagnóstico', 'Resolución y seguimiento']],
  ['Entrevista', ['Objetivo de la entrevista', 'Preguntas', 'Respuestas', 'Observaciones']],
  ['Proyecto', ['Objetivo del proyecto', 'Hitos', 'Riesgos', 'Responsables y plazos']]
]);
const fields = { transcript: 'Transcripción', decisions: 'Decisiones', notes: 'Notas', summary: 'Resumen' };
const stopWords = new Set(('a al algo como con cual cuales cuando cuanto de del desde donde el ella ellos en entre era es esa ese esta estan este fue ha han hasta hay la las lo los me mi nos o para por que quien quienes se segun sin sobre son su sus un una unos y ya ' +
  'a about an and are at be by did do does for from how in is it of on or that the their to was we were what when where which who with').split(' '));
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = text => fold(text).match(/[\p{L}\p{N}]+/gu) || [];
const stamp = seconds => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
};

export function applyTemplate(notes, name) {
  const headings = templates.get(name);
  if (!headings) return notes;
  const present = new Set(notes.split('\n').map(line => line.trim()));
  const missing = headings.map(title => '## ' + title).filter(line => !present.has(line));
  return missing.length ? notes + (notes ? '\n\n' : '') + missing.join('\n\n') + '\n' : notes;
}

// Whisper stores seconds relative to one take. Require full alignment before
// attaching times, including when a user has manually edited the transcript.
export function transcriptTimeline(meeting) {
  const { segments, transcript = '', transcriptAudioId } = meeting;
  if (!Array.isArray(segments) || !segments.length || !transcript) return [];
  const timeline = [];
  let offset = 0, previous = 0;
  for (const segment of segments) {
    const quote = typeof segment?.text === 'string' && segment.text.trim();
    if (!quote || !Number.isFinite(segment.start) || segment.start < previous ||
        !Number.isFinite(segment.end) || segment.end < segment.start) return [];
    while (offset < transcript.length && /\s/u.test(transcript[offset])) offset++;
    if (!transcript.startsWith(quote, offset)) return [];
    timeline.push({ quote, offset, start: segment.start, audioId: transcriptAudioId || null });
    previous = segment.start;
    offset += quote.length;
  }
  return transcript.slice(offset).trim() ? [] : timeline;
}

// Keep exact source offsets even for long paragraphs with no punctuation.
function* passages(text) {
  for (const match of text.matchAll(/\S[^\n]*?(?:[.!?。！？]+(?=\s|$)|(?=\n|$))/gu)) {
    const line = match[0].trimEnd();
    let i = 0;
    while (i < line.length) {
      let end = Math.min(i + 320, line.length);
      if (end < line.length) {
        const space = line.lastIndexOf(' ', end);
        if (space > i) end = space;
        else if (/[\uD800-\uDBFF]/u.test(line[end - 1])) end--;
      }
      yield { quote: line.slice(i, end), offset: match.index + i };
      i = end;
      while (i < line.length && /\s/u.test(line[i])) i++;
    }
  }
}

function citation(meeting, field, part) {
  return { meetingId: meeting.id, title: meeting.title, date: meeting.date, field, ...part };
}

// An extractive answer: every result is a substring of one named meeting field.
// Keep the strongest result per meeting first so a long transcript cannot crowd
// every other meeting out. Within a meeting, return the best distinct excerpts.
export function askMeetings(meetings, question, { transcriptOnly = false, limit = 6 } = {}) {
  const terms = new Set(words(question).filter(term => !stopWords.has(term)));
  if (!terms.size || limit <= 0) return [];
  const groups = [];
  for (const meeting of meetings) {
    const best = [];
    for (const field of transcriptOnly ? ['transcript'] : Object.keys(fields)) {
      const text = meeting[field];
      if (!text) continue;
      const timed = field === 'transcript' ? transcriptTimeline(meeting) : [];
      const parts = timed.length ? timed : passages(text);
      for (const part of parts) {
        const tokens = new Set(words(part.quote));
        let score = 0;
        for (const term of terms) if (tokens.has(term)) score++;
        if (!score || (best.length === limit && score <= best.at(-1).score) ||
            best.some(item => item.quote === part.quote)) continue;
        best.push({ ...citation(meeting, field, part), score });
        best.sort((a, b) => b.score - a.score);
        if (best.length > limit) best.pop();
      }
    }
    if (best.length) groups.push(best);
  }
  groups.sort((a, b) => b[0].score - a[0].score);
  const first = groups.slice(0, limit).map(group => group[0]);
  if (first.length === limit) return first;
  return first.concat(groups.flatMap(group => group.slice(1)).sort((a, b) => b.score - a.score).slice(0, limit - first.length));
}

function sourceLabel(hit) {
  const date = hit.date && new Date(hit.date);
  return [hit.title || 'Sin título', date && Number.isFinite(+date) && date.toLocaleDateString('es-ES'),
    fields[hit.field], hit.start != null && stamp(hit.start)].filter(Boolean).join(' · ');
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action) {
  const node = element('button', label);
  node.type = 'button';
  node.onclick = action;
  return node;
}
function status() {
  const node = element('p', '', 'hint');
  node.setAttribute('role', 'status');
  return node;
}

// Call once after boot. refresh() invalidates results on meeting switches,
// imports and programmatic transcription changes. destroy() releases media.
export function initNotebook({ meeting, meetings, audio }) {
  const notes = document.getElementById('notes');
  const transcript = document.getElementById('transcript');
  const editor = element('details', '', 'ai-tools');
  editor.append(element('summary', 'Cuaderno de reunión'));
  const library = element('article', '', 'card');
  document.querySelector('#dashboard .editor').append(editor);
  document.getElementById('meetings').prepend(library);

  const editorStatus = status(), questionStatus = status();
  const evidence = element('div'), answers = element('div'), timeline = element('div');
  const templateLabel = element('label', 'Plantilla de reunión');
  const select = element('select');
  for (const name of templates.keys()) select.append(element('option', name));
  templateLabel.append(select);
  function writeNotes(value) {
    if (value.length > 200000) {
      editorStatus.textContent = 'Las notas superarían el límite de 200.000 caracteres.';
      return false;
    }
    notes.value = value;
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const apply = button('Añadir plantilla a las notas', () => {
    const next = applyTemplate(notes.value, select.value);
    if (next === notes.value) editorStatus.textContent = 'Las notas ya contienen esta plantilla.';
    else if (writeNotes(next)) editorStatus.textContent = 'Plantilla añadida a las notas.';
  });

  let playback;
  const viewObserver = new MutationObserver(() => {
    if (playback?.row.closest('[hidden]')) stopPlayback();
  });
  for (const view of [editor.closest('.view'), library.closest('.view')]) {
    viewObserver.observe(view, { attributes: true, attributeFilter: ['hidden'] });
  }
  function stopPlayback() {
    if (!playback) return;
    const { player, url } = playback;
    playback = null;
    player.onloadedmetadata = player.onerror = null;
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.remove();
    if (url) URL.revokeObjectURL(url);
  }
  async function play(hit, row, message) {
    stopPlayback();
    const player = element('audio');
    const request = { player, row };
    playback = request;
    player.controls = true;
    player.setAttribute('aria-label', sourceLabel(hit));
    message.textContent = 'Cargando grabación…';
    function fail(text) {
      if (playback !== request) return;
      stopPlayback();
      message.textContent = text;
    }
    try {
      const blob = await audio(hit.audioId);
      if (playback !== request) return;
      if (!blob?.size) return fail('Esta toma no está disponible en este navegador.');
      request.url = URL.createObjectURL(blob);
      player.onloadedmetadata = async () => {
        if (playback !== request) return;
        if (Number.isFinite(player.duration) && hit.start >= player.duration)
          return fail('La marca de tiempo queda fuera de esta toma.');
        try {
          player.currentTime = hit.start;
          await player.play();
          if (playback === request) message.textContent = '';
        } catch {
          if (playback === request) message.textContent = 'Usa el control de reproducción para escuchar esta toma.';
        }
      };
      player.onerror = () => fail('No se pudo reproducir esta toma.');
      player.src = request.url;
      row.append(player);
    } catch { fail('No se pudo leer la grabación en este navegador.'); }
  }
  function excerpt(hit, message) {
    const row = element('div', '', 'ai-section');
    row.append(element('p', sourceLabel(hit), 'hint'), element('blockquote', hit.quote));
    if (hit.audioId && hit.start != null) row.append(button('Escuchar desde ' + stamp(hit.start), () => play(hit, row, message)));
    return row;
  }

  const evidenceButton = button('Buscar evidencia para la nota', () => {
    stopPlayback();
    evidence.replaceChildren();
    const original = notes.value, start = notes.selectionStart, end = notes.selectionEnd;
    const lineStart = original.slice(0, start).lastIndexOf('\n') + 1;
    const newline = original.indexOf('\n', end);
    const lineEnd = newline < 0 ? original.length : newline;
    const query = original.slice(start === end ? lineStart : start, start === end ? lineEnd : end);
    if (!query.trim()) {
      editorStatus.textContent = 'Selecciona una nota o coloca el cursor en su línea.';
      return;
    }
    const current = meeting();
    const currentTranscript = current.transcript;
    const hits = askMeetings([current], query, { transcriptOnly: true, limit: 3 });
    editorStatus.textContent = hits.length ? 'Elige el fragmento que respalda la nota.' : 'Sin coincidencias en la transcripción de esta reunión.';
    for (const hit of hits) {
      const row = excerpt(hit, editorStatus);
      row.append(button('Citar en esta nota', () => {
        const live = meeting();
        if (live.id !== hit.meetingId || live.transcript !== currentTranscript || notes.value !== original) {
          editorStatus.textContent = 'El contenido ha cambiado. Vuelve a buscar evidencia.';
          return;
        }
        const block = '\n> ' + hit.quote.replaceAll('\n', '\n> ') + '\n— ' + sourceLabel(hit) +
          ' (reunión ' + hit.meetingId + ', carácter ' + (hit.offset + 1) + ')';
        if (writeNotes(original.slice(0, lineEnd) + block + original.slice(lineEnd))) {
          evidence.replaceChildren();
          stopPlayback();
          editorStatus.textContent = 'Cita añadida debajo de la nota.';
        }
      }));
      evidence.append(row);
    }
  });

  function renderTimeline() {
    timeline.replaceChildren();
    const current = meeting(), parts = transcriptTimeline(current);
    if (!parts.length) {
      timeline.append(element('p', 'Esta transcripción no tiene marcas de tiempo verificables.', 'hint'));
      return;
    }
    if (!parts[0].audioId) timeline.append(element('p', 'Las marcas de tiempo pertenecen a una transcripción sin toma local vinculada.', 'hint'));
    let shown = 0;
    const more = button('Mostrar más fragmentos', next);
    function next() {
      more.remove();
      for (const part of parts.slice(shown, shown + 20)) {
        timeline.append(excerpt(citation(current, 'transcript', part), editorStatus));
      }
      shown += 20;
      if (shown < parts.length) timeline.append(more);
    }
    next();
  }
  editor.append(templateLabel, apply, evidenceButton, editorStatus, evidence, element('h3', 'Transcripción por tiempo'), timeline);
  editor.ontoggle = () => { if (editor.open) renderTimeline(); else stopPlayback(); };

  const form = element('form'), label = element('label', 'Pregunta sobre tus reuniones');
  const question = element('input');
  question.type = 'search';
  question.maxLength = 500;
  label.append(question);
  const submit = element('button', 'Buscar respuesta');
  submit.type = 'submit';
  form.append(label, submit);
  library.append(element('h2', 'Preguntas entre reuniones'), form, questionStatus, answers);
  form.onsubmit = event => {
    event.preventDefault();
    stopPlayback();
    answers.replaceChildren();
    const current = meeting();
    const saved = meetings().map(m => m.id === current.id ? current : m);
    if (!saved.some(m => m.id === current.id)) saved.push(current);
    const hits = askMeetings(saved, question.value);
    questionStatus.textContent = hits.length ? 'Fragmentos que coinciden con la pregunta: ' + hits.length + '.' :
      'Sin coincidencias. Prueba con un nombre o una expresión de la reunión.';
    for (const hit of hits) {
      const row = excerpt(hit, questionStatus);
      const context = element('details');
      context.append(element('summary', 'Ver contexto de la cita'));
      const source = element('p');
      context.append(source);
      context.ontoggle = () => {
        if (!context.open) return;
        const active = meeting();
        const origin = active.id === hit.meetingId ? active : meetings().find(m => m.id === hit.meetingId);
        const text = origin?.[hit.field], end = hit.offset + hit.quote.length;
        if (!text || text.slice(hit.offset, end) !== hit.quote) {
          source.textContent = 'La fuente ha cambiado. Repite la pregunta para actualizar las citas.';
          return;
        }
        source.replaceChildren(text.slice(Math.max(0, hit.offset - 160), hit.offset),
          element('mark', hit.quote), text.slice(end, end + 160));
      };
      context.append(element('small', 'Reunión ' + hit.meetingId + ' · carácter ' + (hit.offset + 1)));
      row.append(context);
      answers.append(row);
    }
  };
  function refresh() {
    stopPlayback();
    answers.replaceChildren();
    evidence.replaceChildren();
    questionStatus.textContent = editorStatus.textContent = '';
    timeline.replaceChildren();
    if (editor.open) renderTimeline();
  }
  transcript.addEventListener('input', refresh);
  return {
    refresh,
    destroy() {
      stopPlayback();
      viewObserver.disconnect();
      transcript.removeEventListener('input', refresh);
      editor.ontoggle = null;
      editor.remove();
      library.remove();
    }
  };
}
