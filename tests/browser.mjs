import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '') + '/playwright'); }
const artifactDir = await mkdtemp(join(tmpdir(), 'echo404-ui-'));
const server = spawn('python3', ['-u', 'server.py', '--port', '0', '--data-dir', artifactDir], { cwd: resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
const baseURL = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('Server startup timeout')), 10000);
  server.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  server.once('exit', code => reject(Error('Server exited ' + code)));
});
let browser;
const results = [], errors = [];
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name); }
async function waitSaved(page) { await page.waitForFunction(() => document.getElementById('saveState').textContent === 'Guardado en SQLite'); }
try {
  const options = { headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
  if (process.env.ECHO_CHROMIUM) options.executablePath = process.env.ECHO_CHROMIUM;
  browser = await playwright.chromium.launch(options);
  const context = await browser.newContext({ colorScheme: 'light', permissions: ['microphone'], acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL); await page.locator('#saveMeeting').waitFor({ state: 'visible' }); await waitSaved(page);
  await check('Light theme uses light cards and persists after reload', async () => {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('.card').first().evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
    await page.locator('#themeToggle').click(); await page.reload(); await waitSaved(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#themeToggle').click();
  });
  await check('Meeting, tags, project, decisions and separate transcript save without duplicates', async () => {
    await page.locator('#meetingTitle').fill('Seguimiento VPN'); await page.locator('#project').fill('Soporte'); await page.locator('#tags').fill('red, VPN, red');
    await page.locator('#notes').fill('Revisar VPN. Preparar informe.'); await page.locator('#decisions').fill('Aprobar la ventana del lunes');
    await page.locator('#transcriptTab').click(); await page.locator('#transcript').fill('Conversación real de prueba.');
    await page.locator('#saveMeeting').click(); await page.waitForTimeout(650); await waitSaved(page);
    assert.equal(await page.locator('#status').textContent(), 'Guardada');
    await page.locator('#saveMeeting').click(); await page.waitForTimeout(650); await waitSaved(page);
    const { state } = await (await fetch(baseURL + '/api/state')).json();
    assert.equal(state.meetings.length, 1); assert.deepEqual(state.meetings[0].tags, ['red', 'VPN']);
    assert.equal(state.meetings[0].decisions, 'Aprobar la ventana del lunes'); assert.equal(state.meetings[0].notes, 'Revisar VPN. Preparar informe.');
    assert.equal(state.meetings[0].transcript, 'Conversación real de prueba.');
  });
  await check('Linked task creates and edits responsible, priority, deadline and status', async () => {
    await page.locator('#addMeetingTask').click(); await page.locator('#taskText').fill('Validar túnel'); await page.locator('#taskOwner').fill('I. Roig');
    await page.locator('#taskDue').fill('2026-11-23'); await page.locator('#taskFormPriority').selectOption('high'); await page.locator('#taskFormStatus').selectOption('doing');
    await page.locator('#taskForm button[type="submit"]').click();
    await page.locator('#meetingTasks [data-edit-task]').click(); assert.equal(await page.locator('#taskOwner').inputValue(), 'I. Roig');
    await page.locator('#taskFormStatus').selectOption('done'); await page.locator('#taskForm button[type="submit"]').click();
    await page.waitForTimeout(650); await waitSaved(page);
    const { state } = await (await fetch(baseURL + '/api/state')).json();
    assert.equal(state.tasks[0].status, 'done'); assert.equal(state.tasks[0].priority, 'high'); assert.equal(state.tasks[0].due, '2026-11-23'); assert.equal(state.tasks[0].meetingId, state.meetings[0].id);
  });
  await check('Organize is idempotent for meeting tasks', async () => {
    await page.locator('#summarize').click(); await page.locator('#summarize').click(); await page.waitForTimeout(650); await waitSaved(page);
    const { state } = await (await fetch(baseURL + '/api/state')).json(); assert.equal(state.tasks.length, 3);
  });
  await check('Library filters project, tag and decision text', async () => {
    await page.locator('[data-view="meetings"]').click(); await page.locator('#projectFilter').selectOption('Soporte'); await page.locator('#tagFilter').selectOption('VPN');
    await page.locator('#search').fill('ventana'); assert.equal(await page.locator('.meeting-row').count(), 1);
    await page.locator('#search').fill('no existe'); assert.equal(await page.locator('.meeting-row').count(), 0);
    await page.locator('#search').fill(''); await page.locator('[data-open]').click();
  });
  await check('Export Markdown includes decisions and structured tasks', async () => {
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const file = await downloadPromise;
    const content = await readFile(await file.path(), 'utf8'); assert.match(content, /Aprobar la ventana/); assert.match(content, /I. Roig/); assert.match(content, /Conversación real/);
  });
  await check('Transcript downloads produce TXT, Markdown and Word documents', async () => {
    await page.locator('#transcriptTab').click();
    for (const format of ['txt', 'md', 'docx']) {
      await page.locator('#transcriptFormat').selectOption(format);
      const promise = page.waitForEvent('download');
      await page.locator('#downloadTranscript').click();
      const file = await promise;
      assert.match(file.suggestedFilename(), new RegExp('-transcripcion\\.' + format + '$'));
      const data = await readFile(await file.path());
      if (format === 'docx') assert.equal(data.subarray(0, 2).toString(), 'PK');
      else assert.match(data.toString(), /Conversación real de prueba/);
    }
  });
  await check('Fresh browser context restores complete state from SQLite', async () => {
    await page.waitForTimeout(650); await waitSaved(page);
    const fresh = await browser.newContext(); const recovered = await fresh.newPage(); await recovered.goto(baseURL); await waitSaved(recovered);
    assert.equal(await recovered.locator('#meetingTitle').inputValue(), 'Seguimiento VPN'); assert.equal(await recovered.locator('#decisions').inputValue(), 'Aprobar la ventana del lunes');
    assert.equal(await recovered.locator('#meetingTasks .task-row').count(), 3); await fresh.close();
  });
  await check('Concurrent edits produce a conflict instead of overwriting another window', async () => {
    await page.waitForTimeout(650); await waitSaved(page);
    const second = await context.newPage(); await second.goto(baseURL); await waitSaved(second);
    await page.locator('#decisions').fill('Cambio de la primera ventana'); await page.locator('#saveMeeting').click(); await page.waitForTimeout(650); await waitSaved(page);
    await second.locator('#decisions').fill('Cambio de la segunda ventana'); await second.locator('#saveMeeting').click(); await second.locator('#conflict').waitFor({ state: 'visible' });
    const { state } = await (await fetch(baseURL + '/api/state')).json(); assert.equal(state.meetings[0].decisions, 'Cambio de la primera ventana');
    await second.close();
  });
  await check('Invalid backup rows are rejected without replacing current state', async () => {
    await page.locator('[data-view="settings"]').click();
    await page.locator('#backupImport').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ meetings: [{ title: 'Broken' }], tasks: [] })) });
    await page.waitForTimeout(200); assert.match(await page.locator('#toast').textContent(), /incompleta/);
    const { state } = await (await fetch(baseURL + '/api/state')).json(); assert.equal(state.meetings.length, 1);
  });
  await check('Task filters combine responsible, priority and completed state', async () => {
    await page.locator('[data-view="tasks"]').click(); await page.locator('#taskSearch').fill('Roig'); await page.locator('#taskStatus').selectOption('done'); await page.locator('#taskPriority').selectOption('high');
    assert.equal(await page.locator('#tasksList .task-row').count(), 1);
  });
  await check('Denied microphone permission reports recovery and allows retry', async () => {
    await page.locator('[data-view="dashboard"]').click();
    await page.evaluate(() => {
      const media = navigator.mediaDevices;
      window.__realGetUserMedia = media.getUserMedia.bind(media);
      media.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    });
    await page.locator('#record').click();
    await page.waitForFunction(() => document.getElementById('audioState').textContent.includes('Micrófono bloqueado'));
    assert.equal(await page.locator('#record').isEnabled(), true);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__realGetUserMedia; });
  });
  await check('Missing microphone gives a device-specific recovery message', async () => {
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Missing', 'NotFoundError'); };
    });
    await page.locator('#record').click();
    await page.waitForFunction(() => document.getElementById('audioState').textContent.includes('ningún micrófono'));
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__realGetUserMedia; });
  });
  await check('Tab audio requires a shared audio track and records when supplied', async () => {
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        return stream;
      };
    });
    await page.locator('#recordTab').click();
    await page.waitForFunction(() => document.getElementById('audioState').textContent.includes('Compartir audio'));
    await page.locator('#record').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('record').disabled && !document.getElementById('recordTab').disabled);
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    });
    await page.locator('#recordTab').click();
    await page.waitForFunction(() => document.getElementById('audioState').textContent.includes('Audio de pestaña activo'));
    await page.waitForTimeout(900); await page.locator('#record').click();
    await page.locator('#downloadAudio').waitFor({ state: 'visible' });
    await page.waitForTimeout(650); await waitSaved(page);
    const promise = page.waitForEvent('download'); await page.locator('#downloadAudio').click();
    assert.ok((await readFile(await (await promise).path())).length > 0);
  });
  await check('Fake microphone records persistent audio and disables meeting changes', async () => {
    const count = await page.locator('#recordingLibrary button').count();
    await page.locator('[data-view="dashboard"]').click(); await page.locator('#record').click(); await page.waitForTimeout(900);
    assert.equal(await page.locator('#newMeeting').isDisabled(), true); await page.locator('#record').click();
    await page.locator('#downloadAudio').waitFor({ state: 'visible' }); await page.waitForTimeout(650); await waitSaved(page);
    await page.reload(); await waitSaved(page); const filePromise = page.waitForEvent('download'); await page.locator('#downloadAudio').click();
    const file = await filePromise; assert.ok((await readFile(await file.path())).length > 0);
    await page.locator('#record').click(); await page.waitForTimeout(700); await page.locator('#record').click();
    await page.waitForFunction(expected => document.querySelectorAll('#recordingLibrary button').length === expected, count + 2);
    await page.reload(); await waitSaved(page);
    assert.equal(await page.locator('#recordingLibrary button').count(), count + 2);
  });
  await check('Prepared mixed capture meters, pause, resume and disconnect', async () => {
    const count = await page.locator('#recordingLibrary button').count();
    await page.locator('#captureMode').evaluate(el => { el.closest('details').open = true; });
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
        window.testSharedTrack = stream.getAudioTracks()[0];
        return stream;
      };
    });
    await page.locator('#captureMode').selectOption('mixed');
    await page.locator('#prepareCapture').click();
    await page.waitForFunction(() => document.querySelectorAll('#prepareLevels meter').length === 2);
    await page.locator('#startPrepared').click();
    await page.locator('#pauseCapture').click();
    assert.equal(await page.locator('#pauseCapture').textContent(), 'Reanudar');
    await page.locator('#pauseCapture').click(); await page.waitForTimeout(750);
    await page.evaluate(() => window.testSharedTrack.dispatchEvent(new Event('ended')));
    await page.waitForFunction(expected => document.querySelectorAll('#recordingLibrary button').length === expected, count + 1);
  });
  await check('Browser speech appears live and remains saved after reload', async () => {
    await page.evaluate(() => { window.SpeechRecognition = class {
      start() { setTimeout(() => this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Dictado de prueba' } }] }), 30); }
      stop() {}
    }; });
    await page.locator('[data-view="settings"]').click(); await page.locator('#speechEnabled').check();
    await page.locator('[data-view="dashboard"]').click(); await page.locator('#record').click();
    await page.waitForFunction(() => document.getElementById('transcript').value.includes('Dictado de prueba'));
    assert.equal(await page.locator('#transcriptPanel').isVisible(), true);
    await page.locator('#record').click(); await page.locator('#downloadAudio').waitFor({ state: 'visible' });
    await waitSaved(page); await page.reload(); await waitSaved(page);
    assert.match(await page.locator('#transcript').inputValue(), /Dictado de prueba/);
    await page.locator('[data-view="settings"]').click(); await page.locator('#speechEnabled').uncheck();
    await page.locator('[data-view="dashboard"]').click();
  });
  await check('Stopping a recording starts Whisper and saves its transcript', async () => {
    await page.route('**/api/ai/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      whisper: { ready: true }, ollama: { available: false, models: [] }, maxAudioBytes: 128 * 1024 * 1024, maxSummaryChars: 20000
    }) }));
    await page.route('**/api/ai/transcriptions?*', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'browser-test', state: 'running' }) }));
    await page.route('**/api/ai/jobs/browser-test', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      state: 'done', result: { text: 'Transcripción desde el micrófono', segments: [{ start: 0, end: 1, text: 'Transcripción desde el micrófono' }] }
    }) }));
    await page.locator('#record').click(); await page.waitForTimeout(900); await page.locator('#record').click();
    await page.waitForFunction(() => document.getElementById('transcript').value.includes('desde el micrófono'));
    await waitSaved(page);
    const { state } = await (await fetch(baseURL + '/api/state')).json();
    assert.ok(state.meetings.some(m => m.transcript === 'Transcripción desde el micrófono'));
    assert.match(await page.locator('#audioState').textContent(), /Transcripción guardada/);
    await page.unrouteAll();
  });
  await check('Import a voice memo and export the dated task calendar', async () => {
    const count = await page.locator('#recordingLibrary button').count();
    await page.locator('#importTake').setInputFiles(resolve(import.meta.dirname, 'fixtures/es.ogg'));
    await page.waitForFunction(n => document.querySelectorAll('#recordingLibrary button').length === n + 1, count);
    await page.locator('#exportFormat').selectOption('ics');
    const promise = page.waitForEvent('download'); await page.locator('#export').click();
    const body = await readFile(await (await promise).path(), 'utf8');
    assert.match(body, /DTSTART;VALUE=DATE:20261123/);
    assert.match(body, /SUMMARY:Validar túnel/);
    await page.locator('#exportFormat').selectOption('md');
  });
  await check('Mobile navigation and layout work without horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-view="meetings"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-view="dashboard"]').click(); await page.screenshot({ path: join(artifactDir, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: join(artifactDir, 'light.png'), fullPage: true });
    await page.locator('#themeToggle').click(); await page.screenshot({ path: join(artifactDir, 'dark.png'), fullPage: true });
  });
  await check('Interrupted capture recovers committed fragments and round-trips full backup', async () => {
    await page.locator('#newMeeting').click();
    await page.locator('#meetingTitle').fill('Recuperación');
    await page.locator('#record').click();
    const deadline = Date.now() + 100000;
    let before;
    while (Date.now() < deadline) {
      before = await page.evaluate(async () => (await (await import('./storage.js')).listRecordingDrafts()).find(d => d.count >= 12));
      if (before) break;
      await page.waitForTimeout(500);
    }
    assert.ok(before, 'Expected twelve committed five-second fragments');
    assert.ok(before.bytes > 1000);
    await page.reload(); await waitSaved(page);
    await page.locator('[data-view="settings"]').click();
    await page.locator('#recoverTakes').click();
    await page.waitForFunction(() => document.querySelectorAll('#recordingLibrary button').length > 0);
    assert.equal(await page.evaluate(async () => (await (await import('./storage.js')).listRecordingDrafts()).length), 0);
    await page.waitForTimeout(650); await waitSaved(page);
    const promise = page.waitForEvent('download'); await page.locator('#fullExport').click();
    const backup = await (await promise).path();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#fullRestore').setInputFiles(backup);
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('restaurada'));
    const result = await page.evaluate(async id => {
      const take = await (await import('./storage.js')).audioRecord('get',id);
      const ctx = new AudioContext();
      try {
        const buffer = await ctx.decodeAudioData(await take.blob.arrayBuffer());
        return {bytes: take.blob.size, seconds: buffer.duration};
      } finally { await ctx.close(); }
    }, before.id);
    assert.ok(result.bytes >= before.bytes && result.seconds >= 55);
    console.log('Recovery measurement', JSON.stringify(result));
    await page.locator('[data-view="meetings"]').click();
    await page.locator('#search').fill('Seguimiento VPN');
    await page.locator('[data-open]').first().click(); await waitSaved(page);
  });
  await check('Storage quota failure is visible and stops capture', async () => {
    await page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(...args) {
        if (this.name === 'chunks') throw new DOMException('Full', 'QuotaExceededError');
        return add.apply(this, args);
      };
    });
    await page.locator('#record').click();
    await page.waitForFunction(() => document.getElementById('audioState').textContent.includes('Guardado interrumpido'));
    assert.ok(await page.locator('#newMeeting').isEnabled());
    await page.reload(); await waitSaved(page);
  });
  await check('Offline shell opens without caching API responses', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(500);
    const keys = await page.evaluate(async () => { const c = await caches.open('echo-404-1.7.0-rc.1'); return (await c.keys()).map(r => r.url); });
    assert.ok(keys.some(key => key.endsWith('/theme.css'))); assert.ok(keys.every(key => !key.includes('/api/')));
    await context.setOffline(true); await page.reload(); await page.locator('#saveMeeting').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('saveMeeting').disabled); assert.equal(await page.locator('#meetingTitle').inputValue(), 'Seguimiento VPN');
    await context.setOffline(false);
  });
  assert.deepEqual(errors, []);
  await writeFile(join(artifactDir, 'results.json'), JSON.stringify({ checks: results, errors }, null, 2));
  console.log('UI checks: ' + results.length + '; artifacts: ' + artifactDir);
} catch (error) {
  console.error(error); if (browser) { for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: true }).catch(() => {}); } }
  console.error('Artifacts: ' + artifactDir); process.exitCode = 1;
} finally {
  await browser?.close(); server.kill('SIGTERM'); await once(server, 'exit').catch(() => {});
}
