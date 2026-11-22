import { emptyState, normalizeState } from './model.js';
const KEY = 'echo404-v2';
const BACKUP = 'echo404-last-backup';

export class Store {
  constructor(onStatus) {
    this.onStatus = onStatus; this.state = emptyState(); this.revision = null;
    this.pending = false; this.busy = false; this.connected = false; this.conflict = false; this.recovered = false;
    for (const key of [KEY, 'echo404-data', BACKUP]) {
      try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        if (!raw) continue;
        this.state = normalizeState(raw.state || raw);
        this.revision = raw.revision ?? null; this.pending = raw.pending ?? (key !== KEY);
        if (key === BACKUP) this.recovered = true;
        break;
      } catch { /* Retain corrupt bytes in their original key; try recovery next. */ }
    }
  }
  cache() {
    try { localStorage.setItem(KEY, JSON.stringify({ state: this.state, revision: this.revision, pending: this.pending })); }
    catch { this.onStatus('Sin espacio local: exporta una copia', true); }
  }
  async connect() {
    try {
      const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw Error();
      const remote = await response.json(); this.connected = true;
      if (this.pending && this.revision !== remote.revision && !(this.revision === null && remote.revision === 0 && !remote.state.meetings.length)) {
        this.conflict = true; this.onStatus('Hay cambios en otra ventana', true); return;
      }
      if (!this.pending) this.state = normalizeState(remote.state);
      this.revision = remote.revision; this.cache();
      if (this.pending) await this.sync(); else this.onStatus('Guardado en SQLite');
    } catch { this.connected = false; this.onStatus('Modo local · servidor no disponible'); }
  }
  save() { this.pending = true; this.onStatus('Guardando…'); this.cache(); clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 300); }
  async sync() {
    if (this.busy || this.conflict) return;
    if (!this.connected) { this.onStatus('Guardado en este navegador'); return; }
    this.busy = true;
    try {
      while (this.pending) {
        const state = JSON.stringify(this.state);
        const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Echo-Client': 'echo-404' }, body: JSON.stringify({ expectedRevision: this.revision, state: JSON.parse(state) }), signal: AbortSignal.timeout(8000) });
        if (response.status === 409) { this.conflict = true; this.onStatus('Hay cambios en otra ventana', true); break; }
        if (!response.ok) throw Error('No se pudo guardar');
        this.revision = (await response.json()).revision;
        this.pending = JSON.stringify(this.state) !== state; this.cache();
      }
      if (!this.conflict) this.onStatus('Guardado en SQLite');
    } catch { this.connected = false; this.onStatus('Copia local pendiente de sincronizar', true); }
    finally { this.busy = false; }
  }
  async useServer() {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw Error('Servidor no disponible');
    const remote = await response.json();
    localStorage.setItem('echo404-before-conflict', JSON.stringify(this.state));
    this.state = normalizeState(remote.state); this.revision = remote.revision; this.pending = false;
    this.connected = true; this.conflict = false; this.cache(); this.onStatus('Versión del servidor recuperada');
  }
  backup() {
    if (!this.state.settings.autoBackup) return;
    try { localStorage.setItem(BACKUP, JSON.stringify({ state: this.state, savedAt: new Date().toISOString() })); }
    catch { this.onStatus('No se pudo crear la copia local', true); }
  }
}

export function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('echo404-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function audioRecord(action, value) {
  const database = await openAudioDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('recordings', action === 'get' ? 'readonly' : 'readwrite');
    const objectStore = transaction.objectStore('recordings');
    const request = action === 'get' ? objectStore.get(value) : action === 'clear' ? objectStore.clear() : objectStore.put(value);
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error || Error('Guardado cancelado')); };
  });
}
