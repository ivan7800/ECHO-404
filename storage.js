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
    if (this.restoring || this.connecting) return;
    this.connecting = true;
    let hasRestore;
    try { hasRestore = localStorage.getItem(RESTORE_FLAG); } catch { /* SQLite can work without a local cache. */ }
    try {
      if (hasRestore) await finishRestore(this);
    } catch {
      this.connecting = false;
      this.connected = false;
      this.onStatus('Restauración pendiente: comprueba el almacenamiento y vuelve a conectar', true);
      return;
    }
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
    finally { this.connecting = false; }
  }
  save() { this.pending = true; this.onStatus('Guardando…'); this.cache(); clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 300); }
  async sync() {
    if (this.busy || this.conflict || this.restoring) return;
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
  async restoreFullBackup(file) {
    if (this.busy || this.connecting || this.restoring) throw Error('Espera a que termine la operación en curso');
    this.restoring = true;
    let committed = false;
    try {
      const { state, recordings, drafts, chunks } = await readFullBackup(file);
      await audioTransaction([...AUDIO_STORES, 'restore'], 'readwrite', async tx => {
        // The marker and replacement audio commit together. On reload connect()
        // finishes copying the state to the normal cache before contacting SQLite.
        const journal = tx.objectStore('restore');
        if (await resultOf(journal.get('pending')) && localStorage.getItem(RESTORE_FLAG)) throw Error('Hay una restauración pendiente');
        localStorage.setItem(RESTORE_FLAG, '1');
        for (const [name, rows] of [['recordings', recordings], ['drafts', drafts], ['chunks', chunks]]) {
          const target = tx.objectStore(name);
          target.clear();
          for (const row of rows) target.add(row);
        }
        tx.objectStore('restore').put({ state, revision: this.revision, pending: true }, 'pending');
      });
      committed = true;
      try { await finishRestore(this); }
      catch (error) {
        this.connected = false;
        throw Error('Copia guardada en IndexedDB. Libera espacio y vuelve a conectar para completar la restauración.', { cause: error });
      }
      committed = false;
    } finally {
      this.restoring = false;
      if (this.pending && !committed) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.sync(), 300);
      }
    }
    return this.state;
  }
  backup() {
    if (!this.state.settings.autoBackup) return;
    try { localStorage.setItem(BACKUP, JSON.stringify({ state: this.state, savedAt: new Date().toISOString() })); }
    catch { this.onStatus('No se pudo crear la copia local', true); }
  }
}

const AUDIO_STORES = ['recordings', 'drafts', 'chunks'];
const RESTORE_FLAG = 'echo404-restore-pending';

export function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('echo404-audio', 3);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(Error('Cierra las otras pestañas de ECHO para actualizar la base de audio'));
    };
    request.onupgradeneeded = () => {
      if (blocked) { request.transaction.abort(); return; }
      const db = request.result;
      const records = db.objectStoreNames.contains('recordings')
        ? request.transaction.objectStore('recordings') : db.createObjectStore('recordings', { keyPath: 'id' });
      if (!records.indexNames.contains('meetingId')) records.createIndex('meetingId', 'meetingId');
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['id', 'sequence'] });
      db.createObjectStore('restore');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function audioTransaction(stores, mode, work) {
  const db = await openAudioDb();
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('Operación de audio cancelada'));
    });
    let value;
    try { value = await work(tx); }
    catch (error) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await done.catch(() => {});
      throw error;
    }
    await done;
    return value;
  } finally { db.close(); }
}

async function finishRestore(store) {
  await audioTransaction(['restore'], 'readwrite', async tx => {
    const journal = tx.objectStore('restore');
    const cached = await resultOf(journal.get('pending'));
    if (cached) {
      localStorage.setItem(KEY, JSON.stringify(cached));
      Object.assign(store, cached);
      journal.delete('pending');
    }
    localStorage.removeItem(RESTORE_FLAG);
  });
}

export function audioRecord(action, value) {
  if (action === 'clear') return audioTransaction(AUDIO_STORES, 'readwrite', tx => {
    for (const name of AUDIO_STORES) tx.objectStore(name).clear();
  });
  return audioTransaction(['recordings'], action === 'put' ? 'readwrite' : 'readonly', tx => {
    const records = tx.objectStore('recordings');
    switch (action) {
      case 'get': return resultOf(records.get(value));
      case 'list': return resultOf(records.index('meetingId').getAll(value));
      case 'put': return resultOf(records.put(value));
      default: throw Error('Operación de audio desconocida');
    }
  });
}

const isId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const chunkRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

export async function beginRecording(meetingId, mimeType = '', source = 'microphone') {
  if (!isId(meetingId) || typeof mimeType !== 'string' || typeof source !== 'string' || !source) throw Error('Datos de grabación no válidos');
  const draft = { id: crypto.randomUUID(), meetingId, mimeType, source, createdAt: Date.now(), count: 0, bytes: 0, duration: 0 };
  await audioTransaction(['drafts'], 'readwrite', tx => resultOf(tx.objectStore('drafts').add(draft)));
  return draft.id;
}

export function appendRecordingChunk(id, sequence, blob, duration = 0) {
  return audioTransaction(['drafts', 'chunks'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    const draft = await resultOf(drafts.get(id));
    if (!draft || sequence !== draft.count) throw Error('Grabación inexistente o fragmento fuera de orden');
    if (!(blob instanceof Blob) || !blob.size || !isCount(duration)) throw Error('Fragmento de audio no válido');
    tx.objectStore('chunks').add({ id, sequence, blob });
    draft.count++;
    draft.bytes += blob.size;
    draft.duration = Math.max(draft.duration, duration);
    draft.mimeType ||= blob.type;
    drafts.put(draft);
  });
}

export function listRecordingDrafts() {
  return audioTransaction(['drafts'], 'readonly', tx => resultOf(tx.objectStore('drafts').getAll()));
}

export function discardRecordingDraft(id) {
  return audioTransaction(['drafts', 'chunks'], 'readwrite', tx => {
    tx.objectStore('chunks').delete(chunkRange(id));
    tx.objectStore('drafts').delete(id);
  });
}

export function finalizeRecordingDraft(id, status = 'guardada') {
  return audioTransaction(AUDIO_STORES, 'readwrite', async tx => {
    const records = tx.objectStore('recordings');
    const draft = await resultOf(tx.objectStore('drafts').get(id));
    if (!draft) {
      const saved = await resultOf(records.get(id));
      if (saved) return saved; // Safe to retry after losing the completion notification.
      throw Error('Grabación inexistente');
    }
    const chunks = tx.objectStore('chunks');
    const rows = await resultOf(chunks.getAll(chunkRange(id)));
    const blob = new Blob(rows.map(row => row.blob), { type: draft.mimeType });
    if (!blob.size || blob.size !== draft.bytes || rows.length !== draft.count ||
        rows.some((row, i) => row.sequence !== i)) throw Error('Grabación incompleta o vacía');
    if (typeof status !== 'string' || !status) throw Error('Estado de grabación no válido');
    const record = { id, meetingId: draft.meetingId, createdAt: draft.createdAt, duration: draft.duration,
      source: draft.source, size: blob.size, status, blob };
    records.add(record);
    chunks.delete(chunkRange(id));
    tx.objectStore('drafts').delete(id);
    return record;
  });
}

// A short versioned header, UTF-8 JSON manifest, then raw Blob payloads in
// recordings/chunks order. Binary audio is never converted to JSON or base64.
const MAGIC = 'ECHO404-FULL-1\n';
const HEADER_BYTES = MAGIC.length + 4;
const MAX_MANIFEST = 32 * 1024 * 1024;

async function sha256(blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

function validateInventory(state, recordings, drafts, chunks) {
  if (![recordings, drafts, chunks].every(Array.isArray)) throw Error('Inventario de audio no válido');
  const saved = new Map();
  for (const record of recordings) {
    if (!isId(record?.id) || saved.has(record.id) || (record.meetingId != null && !isId(record.meetingId))) {
      throw Error('Identificador de audio no válido o repetido');
    }
    saved.set(record.id, record);
  }
  for (const meeting of state.meetings) {
    if (!meeting.audioId) continue;
    const record = saved.get(meeting.audioId);
    if (!record || (record.meetingId != null && record.meetingId !== meeting.id)) {
      throw Error('Falta el audio de la reunión ' + meeting.id);
    }
  }
  const totals = new Map();
  for (const d of drafts) {
    if (!isId(d?.id) || saved.has(d.id) || totals.has(d.id) || !isId(d.meetingId) ||
        typeof d.mimeType !== 'string' || ![d.createdAt, d.count, d.bytes, d.duration].every(isCount)) {
      throw Error('Borrador de grabación no válido');
    }
    totals.set(d.id, { count: 0, bytes: 0 });
  }
  for (const chunk of chunks) {
    const total = totals.get(chunk?.id);
    if (!total || total.count !== chunk.sequence) throw Error('Fragmentos ausentes, desordenados o repetidos');
    total.count++;
    total.bytes += chunk.byteLength;
  }
  for (const d of drafts) {
    const total = totals.get(d.id);
    if (d.count !== total.count || d.bytes !== total.bytes) throw Error('Borrador de grabación incompleto');
  }
}

export async function exportFullBackup(inputState) {
  const state = normalizeState(inputState);
  const [recordings, drafts, chunks] = await audioTransaction(AUDIO_STORES, 'readonly', tx =>
    Promise.all(AUDIO_STORES.map(name => resultOf(tx.objectStore(name).getAll()))));
  const parts = [];
  async function describe(rows) {
    const entries = [];
    for (const { blob, ...metadata } of rows) {
      if (!(blob instanceof Blob) || !blob.size) throw Error('Audio vacío o ilegible');
      entries.push({ ...metadata, type: blob.type, byteLength: blob.size, sha256: await sha256(blob) });
      parts.push(blob);
    }
    return entries;
  }
  const manifest = { state, drafts, recordings: await describe(recordings), chunks: await describe(chunks) };
  validateInventory(state, manifest.recordings, drafts, manifest.chunks);
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.length > MAX_MANIFEST) throw Error('El índice de la copia supera 32 MiB');
  const length = new DataView(new ArrayBuffer(4));
  length.setUint32(0, json.length);
  return new Blob([MAGIC, length, json, ...parts], { type: 'application/octet-stream' });
}

async function readFullBackup(file) {
  if (!(file instanceof Blob) || file.size < HEADER_BYTES ||
      await file.slice(0, MAGIC.length).text() !== MAGIC) throw Error('Formato o versión de copia no compatible');
  const length = new DataView(await file.slice(MAGIC.length, HEADER_BYTES).arrayBuffer()).getUint32(0);
  let offset = HEADER_BYTES + length;
  if (length > MAX_MANIFEST || offset > file.size) throw Error('Índice de copia no válido');
  const manifest = JSON.parse(await file.slice(HEADER_BYTES, offset).text());
  const state = normalizeState(manifest.state);
  const { recordings, drafts, chunks } = manifest;
  validateInventory(state, recordings, drafts, chunks);
  async function decode(rows) {
    const decoded = [];
    for (const { byteLength: size, type, sha256: expected, ...metadata } of rows) {
      if (!isCount(size) || !size || size > file.size - offset || typeof type !== 'string' ||
          typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) throw Error('Entrada de audio no válida');
      const blob = file.slice(offset, offset + size, type);
      if (await sha256(blob) !== expected) throw Error('Audio dañado en la copia');
      decoded.push({ ...metadata, blob });
      offset += size;
    }
    return decoded;
  }
  const result = { state, drafts, recordings: await decode(recordings), chunks: await decode(chunks) };
  if (offset !== file.size) throw Error('Datos adicionales en la copia');
  return result;
}
