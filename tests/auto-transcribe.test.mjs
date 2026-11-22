import test from 'node:test';
import assert from 'node:assert/strict';
import { setupAI } from '../ai-client.js';
import { newMeeting } from '../model.js';

test('a saved recording is transcribed and applied automatically when Whisper is ready', async () => {
  const elements = new Map();
  globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, hidden: false, textContent: '',
      replaceChildren(...items) { this.value = items[0]?.value || ''; }
    });
    return elements.get(id);
  } };
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const meeting = { ...newMeeting(), audioId: 'audio-1' };
  const statuses = [];
  let uploaded = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.endsWith('/status')) return { ok: true, json: async () => ({
      whisper: { ready: true }, ollama: { models: [] }, maxAudioBytes: 128 * 1024 * 1024
    }) };
    if (path.includes('/transcriptions?')) {
      uploaded++;
      assert.equal(init.body.size, 5);
      return { ok: true, json: async () => ({ id: 'job-1', state: 'running' }) };
    }
    if (path.endsWith('/jobs/job-1')) return { ok: true, json: async () => ({
      state: 'done', result: { text: 'Voz reconocida', segments: [{ start: 0, end: 1, text: 'Voz reconocida' }] }
    }) };
    throw Error('Unexpected request ' + path);
  };
  const update = setupAI({ meeting: () => meeting, audio: async () => new Blob(['audio']),
    blocked: () => false, apply: (kind, proposal) => { assert.equal(kind, 'transcription'); meeting.transcript = proposal.text; },
    download: () => {}, onTranscriptStatus: text => statuses.push(text) });
  await update.transcribeSaved();
  for (let i = 0; i < 20 && !meeting.transcript; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(meeting.transcript, 'Voz reconocida');
  assert.equal(uploaded, 1);
  assert.match(statuses.at(-1), /Transcripción guardada/);
});
