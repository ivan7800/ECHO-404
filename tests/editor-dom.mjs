// Integration with production HTML, app modules, a real HTTP server and installed
// models. jsdom supplies the DOM; modal open/close are emulated (no rendering).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.ECHO_TEST_JS_MODULES || process.cwd()] }));
const { indexedDB } = require(require.resolve('fake-indexeddb', { paths: [process.env.ECHO_TEST_JS_MODULES || process.cwd()] }));
const [audioPath, modelName] = process.argv.slice(2);
if (!audioPath || !modelName) throw Error('Uso: node tests/editor-dom.mjs muestra.flac modelo-ollama');
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'echo404-dom-'));
const server = spawn('python3', ['-u', 'server.py', '--port', '0', '--data-dir', dir], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const ended = once(server, 'exit');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await sleep(100); } while (Date.now() < deadline);
  throw Error('Tiempo agotado: ' + label);
}
try {
  let origin;
  server.stdout.on('data', b => { origin ||= b.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  await until(() => origin, 'arranque', 10000);
  const dom = new JSDOM(await readFile(join(root, 'index.html'), 'utf8'), { url: origin, pretendToBeVisual: true });
  const { window } = dom;
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'Option']) globalThis[k] = window[k];
  globalThis.indexedDB = indexedDB;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const nativeFetch = globalThis.fetch, nativeInterval = globalThis.setInterval;
  globalThis.fetch = (input, options) => nativeFetch(new URL(input, origin), options);
  globalThis.setInterval = (...args) => nativeInterval(...args).unref();
  const $ = id => document.getElementById(id);
  const state = async () => (await (await fetch('/api/state')).json()).state;
  await import('../app.js');
  await until(() => !$('saveMeeting').disabled && $('saveState').textContent.includes('SQLite'), 'editor');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal($('themeToggle').textContent.includes('Modo oscuro'), true);
  $('themeToggle').click();
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal($('themeToggle').textContent.includes('Modo claro'), true);
  assert.equal(localStorage.getItem('echo404-theme'), 'light');
  $('themeToggle').click();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  console.log('OK temas: oscuro, claro y preferencia persistente.');
  $('meetingTitle').value = 'Audio de prueba';
  $('transcript').value = 'Texto previo';
  $('saveMeeting').click();
  $('aiTools').open = true;
  await until(() => !$('aiChoose').disabled, 'Whisper disponible');
  $('aiLanguage').value = 'en';
  const file = new File([await readFile(audioPath)], 'muestra.flac');
  Object.defineProperty($('aiFile'), 'files', { value: [file] });
  $('aiFile').dispatchEvent(new window.Event('change'));
  $('newMeeting').click();
  await until(() => !$('aiReview').hidden, 'propuesta Whisper');
  $('aiReview').click();
  assert.equal($('aiApply').disabled, true);
  assert.ok($('aiPreview').textContent.toLowerCase().includes('country'));
  $('aiClose').click();
  const old = (await state()).meetings.find(m => m.title === 'Audio de prueba');
  assert.equal(old.transcript, 'Texto previo');
  document.querySelector('[data-open="' + old.id + '"]').click();
  $('aiReview').click();
  assert.equal($('aiApply').disabled, false);
  $('aiApply').click();
  await until(async () => (await state()).meetings.find(m => m.id === old.id).transcript.toLowerCase().includes('country'), 'transcripción en SQLite');
  console.log('OK Whisper: propuesta, bloqueo en otra reunión y aplicación explícita en SQLite.');

  $('newMeeting').click();
  $('meetingTitle').value = 'Reunión con Elena';
  $('notes').value = 'Acordamos migrar el lunes. Elena enviará el informe el 2026-12-01.';
  $('summary').value = 'Borrador manual';
  $('saveMeeting').click();
  $('aiModel').value = modelName;
  assert.equal($('aiModel').value, modelName);
  $('aiSummary').click();
  await until(() => !$('aiReview').hidden, 'propuesta Ollama', 245000);
  $('aiReview').click();
  assert.equal($('summary').value, 'Borrador manual');
  assert.ok($('aiSummaryDraft').value.trim());
  $('aiSummaryDraft').value = 'Acta corregida tras revisar.';
  $('aiDraftTasks').replaceChildren();
  $('aiAddDraft').click();
  const inputs = $('aiDraftTasks').querySelectorAll('input');
  inputs[0].value = 'Enviar informe'; inputs[1].value = 'Elena'; inputs[2].value = '2026-12-01';
  $('aiApply').click();
  await until(async () => {
    const s = await state(), m = s.meetings.find(m => m.title === 'Reunión con Elena');
    return m?.summary === 'Acta corregida tras revisar.' && s.tasks.some(t => t.meetingId === m.id && t.owner === 'Elena' && t.due === '2026-12-01');
  }, 'acta revisada y tarea en SQLite');
  console.log('OK Ollama: acta revisada, original conservado hasta pulsar Aplicar y guardado en SQLite.');
  const track = new window.EventTarget();
  track.stop = () => {};
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({
    getTracks: () => [track], getAudioTracks: () => [track]
  }) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  class Recorder {
    static isTypeSupported = () => true;
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['audio de prueba'], { type: this.mimeType }) });
      this.onstop();
    }
  }
  globalThis.MediaRecorder = window.MediaRecorder = Recorder;
  const nativePerformance = globalThis.performance;
  let elapsed = 0;
  globalThis.performance = { now: () => elapsed };
  $('record').click();
  await until(() => $('status').textContent === 'Grabando', 'grabación simulada', 4000);
  elapsed = 90 * 60 * 1000;
  await until(() => $('status').textContent === 'Guardada' && $('downloadAudio').classList.contains('hidden') === false, 'corte automático a los 90 minutos', 5000);
  assert.equal($('timer').textContent, '01:30:00');
  assert.equal($('newMeeting').disabled, false);
  await until(() => $('saveState').textContent === 'Guardado en SQLite', 'guardado de la toma');
  globalThis.performance = nativePerformance;
  console.log('OK grabación: se cierra a los 90 minutos, conserva el audio y habilita nueva reunión.');
} finally {
  server.kill();
  await ended;
  await rm(dir, { recursive: true, force: true });
}
