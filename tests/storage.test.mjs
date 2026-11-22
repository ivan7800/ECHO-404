import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../storage.js';
import { emptyState, newMeeting } from '../model.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const nativeFetch = globalThis.fetch;
let server, baseURL;
before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'echo404-store-'));
  server = spawn('python3', ['-u', 'server.py', '--port', '0', '--data-dir', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  baseURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Server timeout')), 10000);
    server.stdout.on('data', value => { const match = String(value).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, baseURL), options);
});
after(async () => { globalThis.fetch = nativeFetch; server.kill('SIGTERM'); await once(server, 'exit'); });

test('recovers corrupt primary cache from legacy backup without erasing original bytes', () => {
  globalThis.localStorage = new MemoryStorage(); localStorage.setItem('echo404-v2', '{bad json');
  const state = emptyState(); state.meetings.push(newMeeting()); localStorage.setItem('echo404-last-backup', JSON.stringify(state));
  const store = new Store(() => {}); assert.equal(store.state.meetings.length, 1); assert.equal(store.recovered, true);
  assert.equal(localStorage.getItem('echo404-v2'), '{bad json');
});
test('local quota errors are surfaced rather than reported as saved', () => {
  globalThis.localStorage = new MemoryStorage(); const messages = []; const store = new Store(text => messages.push(text));
  localStorage.setItem = () => { throw Error('quota'); }; store.cache(); assert.ok(messages.some(t => t.includes('Sin espacio')));
});
test('roundtrip saves all fields and does not create duplicate meetings', async () => {
  globalThis.localStorage = new MemoryStorage(); const store = new Store(() => {}); await store.connect();
  const meeting = { ...newMeeting(), title: 'Persistencia real', decisions: 'Aprobado', project: 'Soporte', tags: ['VPN'] };
  store.state.meetings.push(meeting); store.save(); await store.sync();
  store.state.meetings[0].notes = 'Actualizado'; store.save(); await store.sync();
  globalThis.localStorage = new MemoryStorage(); const fresh = new Store(() => {}); await fresh.connect();
  assert.equal(fresh.state.meetings.length, 1); assert.equal(fresh.state.meetings[0].notes, 'Actualizado');
  assert.equal(fresh.state.meetings[0].decisions, 'Aprobado'); assert.deepEqual(fresh.state.meetings[0].tags, ['VPN']);
  clearTimeout(store.timer);
});
test('concurrent writers retain their pending edits and require explicit conflict resolution', async () => {
  globalThis.localStorage = new MemoryStorage(); const first = new Store(() => {}), second = new Store(() => {});
  await first.connect(); await second.connect(); first.state.meetings[0].title = 'First writer'; first.save(); await first.sync();
  second.state.meetings[0].title = 'Second writer'; second.save(); await second.sync();
  assert.equal(second.conflict, true); assert.equal(second.pending, true); assert.equal(second.state.meetings[0].title, 'Second writer');
  await second.useServer(); assert.equal(second.state.meetings[0].title, 'First writer'); assert.equal(second.conflict, false);
  clearTimeout(first.timer); clearTimeout(second.timer);
});
test('offline edits survive failed network writes and reconnect when revisions match', async () => {
  globalThis.localStorage = new MemoryStorage(); const store = new Store(() => {}); await store.connect();
  const goodFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error('offline'); };
  store.state.meetings[0].notes = 'Offline note'; store.save(); await store.sync(); assert.equal(store.pending, true);
  const recovered = new Store(() => {}); assert.equal(recovered.state.meetings[0].notes, 'Offline note');
  globalThis.fetch = goodFetch; await recovered.connect(); assert.equal(recovered.pending, false);
  const state = await (await fetch('/api/state')).json(); assert.equal(state.state.meetings[0].notes, 'Offline note'); clearTimeout(store.timer);
});
test('explicit clear persists as empty state and is not reimported from old meetings', async () => {
  globalThis.localStorage = new MemoryStorage(); const store = new Store(() => {}); await store.connect();
  store.state = emptyState(); store.save(); await store.sync();
  const fresh = new Store(() => {}); await fresh.connect(); assert.equal(fresh.state.meetings.length, 0); clearTimeout(store.timer);
});
