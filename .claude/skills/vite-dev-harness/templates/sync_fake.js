// Backend en mémoire, persisté dans localStorage (clé 'cartes-familiales:fake-rooms')
// pour survivre à une vraie navigation/rechargement de page (indispensable pour
// tester main.js:boot() — un simple Map en mémoire de module serait perdu à
// chaque reload). Même contrat que supabase/sync.js — voir ce fichier pour la
// doc de chaque fonction.
export class ConflictError extends Error {
  constructor() {
    super('La partie a été mise à jour ailleurs, resynchronisation…');
    this.name = 'ConflictError';
  }
}

const STORAGE_KEY = 'cartes-familiales:fake-rooms';

function loadRooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch (e) {
    return new Map();
  }
}

function saveRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(rooms)));
}

function clone(row) {
  return row ? JSON.parse(JSON.stringify(row)) : row;
}

export async function createRoom(initialState, game = 'pouilleux') {
  const rooms = loadRooms();
  const id = crypto.randomUUID();
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const row = { id, code, game, state: initialState, version: 0, updated_at: new Date().toISOString() };
  rooms.set(id, row);
  saveRooms(rooms);
  return clone(row);
}

export async function getOrCreateRoomByCode(code, initialState, game = 'pouilleux') {
  const existing = await fetchRoomByCode(code);
  if (existing) return existing;
  const rooms = loadRooms();
  const id = crypto.randomUUID();
  const row = { id, code: code.toUpperCase(), game, state: initialState, version: 0, updated_at: new Date().toISOString() };
  rooms.set(id, row);
  saveRooms(rooms);
  return clone(row);
}

export async function fetchRoomByCode(code) {
  const rooms = loadRooms();
  for (const row of rooms.values()) {
    if (row.code.toUpperCase() === code.toUpperCase()) return clone(row);
  }
  return null;
}

export async function fetchRoomById(id) {
  return clone(loadRooms().get(id)) || null;
}

export async function listRooms(limit = 20) {
  return Array.from(loadRooms().values())
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit)
    .map(clone);
}

// `storage` ne se déclenche que dans les AUTRES onglets, jamais celui qui a
// écrit — insuffisant pour re-render l'onglet qui vient lui-même de cliquer
// "Ajouter un bot"/"Lancer" etc. Pub-sub local en plus, pour ce même onglet.
const localSubscribers = new Set(); // { roomId, cb }

function notifyLocal(roomId, row) {
  for (const sub of localSubscribers) {
    if (sub.roomId === roomId) sub.cb(row);
  }
}

export async function updateRoomState(roomId, expectedVersion, newState, extraColumns = {}) {
  const rooms = loadRooms();
  const row = rooms.get(roomId);
  if (!row || row.version !== expectedVersion) throw new ConflictError();
  const updated = { ...row, ...extraColumns, state: newState, version: expectedVersion + 1, updated_at: new Date().toISOString() };
  rooms.set(roomId, updated);
  saveRooms(rooms);
  notifyLocal(roomId, clone(updated));
  return clone(updated);
}

export async function deleteRoom(id) {
  const rooms = loadRooms();
  rooms.delete(id);
  saveRooms(rooms);
}

export function subscribeRoom(roomId, onChange) {
  let active = true;
  fetchRoomById(roomId).then((row) => {
    if (active && row) onChange(row);
  });
  const onStorage = (e) => {
    if (!active || e.key !== STORAGE_KEY) return;
    fetchRoomById(roomId).then((row) => {
      if (active && row) onChange(row);
    });
  };
  window.addEventListener('storage', onStorage);
  const sub = { roomId, cb: (row) => active && onChange(row) };
  localSubscribers.add(sub);
  return () => {
    active = false;
    window.removeEventListener('storage', onStorage);
    localSubscribers.delete(sub);
  };
}
