import { supabase } from './client.js';

export class ConflictError extends Error {
  constructor() {
    super('La partie a été mise à jour ailleurs, resynchronisation…');
    this.name = 'ConflictError';
  }
}

function randomCode(length = 4) {
  // Alphabet sans caractères ambigus (0/O, 1/I) pour être tapé facilement à la main.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export async function createRoom(initialState, game = 'pouilleux') {
  // On tente quelques codes au cas (rare) où il y aurait déjà une collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { data, error } = await supabase
      .from('game_rooms')
      .insert({ code, game, state: initialState, version: 0 })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // autre chose qu'une collision d'unicité -> on remonte l'erreur
  }
  throw new Error("Impossible de créer une partie, réessaie.");
}

/**
 * Récupère la table identifiée par `code`, ou la crée si elle n'existe pas encore.
 * Gère la course possible entre deux appareils de la famille qui démarreraient
 * l'appli en même temps pour la toute première fois.
 */
export async function getOrCreateRoomByCode(code, initialState, game = 'pouilleux') {
  const existing = await fetchRoomByCode(code);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('game_rooms')
    .insert({ code: code.toUpperCase(), game, state: initialState, version: 0 })
    .select()
    .single();

  if (!error) return data;
  if (error.code === '23505') {
    const fresh = await fetchRoomByCode(code);
    if (fresh) return fresh;
  }
  throw error;
}

export async function fetchRoomByCode(code) {
  const { data, error } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();
  if (error) return null;
  return data;
}

export async function fetchRoomById(id) {
  const { data, error } = await supabase.from('game_rooms').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

/**
 * Liste les salons les plus récemment actifs (écran "salons"), triés par
 * activité récente et bornés pour ne pas remonter des salons abandonnés
 * depuis des mois. Renvoie les lignes brutes (state complet, y compris les
 * mains) : la projection "sûre" pour l'affichage se fait dans engine.js
 * (`listActiveRooms`), pas ici — ce fichier reste un simple miroir de la
 * table Supabase comme le reste du fichier.
 */
export async function listRooms(limit = 20) {
  const { data, error } = await supabase
    .from('game_rooms')
    .select('id, code, game, state, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Met à jour l'état d'une partie avec verrou optimiste basé sur `version`.
 * `extraColumns` permet de modifier d'autres colonnes en même temps (ex: `game`
 * au moment de lancer une nouvelle partie). Si quelqu'un d'autre a écrit entre
 * temps, lève ConflictError : l'appelant doit relire l'état à jour et, si
 * besoin, réappliquer son action.
 */
export async function updateRoomState(roomId, expectedVersion, newState, extraColumns = {}) {
  const { data, error } = await supabase
    .from('game_rooms')
    .update({ ...extraColumns, state: newState, version: expectedVersion + 1 })
    .eq('id', roomId)
    .eq('version', expectedVersion)
    .select()
    .single();

  if (error || !data) throw new ConflictError();
  return data;
}

/**
 * Supprime un salon (plus personne d'humain dedans — voir `leaveTable` dans
 * engine.js). Pas de verrou optimiste ici : une suppression n'a pas besoin
 * d'être rejouée si quelqu'un d'autre a écrit entre-temps, contrairement à
 * `updateRoomState`.
 */
export async function deleteRoom(id) {
  const { error } = await supabase.from('game_rooms').delete().eq('id', id);
  if (error) throw error;
}

/**
 * S'abonne aux changements d'une partie. Appelle onChange(row) à chaque mise à jour,
 * et une première fois immédiatement avec l'état courant.
 * Retourne une fonction de désinscription.
 */
export function subscribeRoom(roomId, onChange) {
  let active = true;

  fetchRoomById(roomId).then((row) => {
    if (active && row) onChange(row);
  });

  const channel = supabase
    .channel(`game_rooms:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
      (payload) => {
        if (active) onChange(payload.new);
      }
    )
    .subscribe();

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}
