// Mécaniques transverses : gestion des salons (créer/rejoindre/quitter,
// présence, hôte), et rien de spécifique à un jeu en particulier — voir
// engine.js, qui assemble ce fichier avec la découverte dynamique des jeux
// (src/game/<id>.js) pour former l'API complète utilisée par l'UI.
import { createRoom, listRooms, deleteRoom, fetchRoomByCode } from '../supabase/sync.js';
import { fetchRoomById, updateRoomState, subscribeRoom, ConflictError, initRelay, isRelayActive, stopRelay } from '../webrtc/relay.js';

export { ConflictError, fetchRoomById, updateRoomState, initRelay, isRelayActive, stopRelay, fetchRoomByCode };

/**
 * Applique une action pure sur l'état puis l'écrit avec verrou optimiste.
 * En cas de conflit de version (ping présence, autre appareil, bot…),
 * relit l'état frais et réessaie — si le tour a changé, `computeNewState`
 * lève une erreur métier plus claire que ConflictError.
 */
export async function commitGameAction(room, computeNewState, extraColumns = {}) {
  let current = room;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const newState = computeNewState(current.state);
      return await updateRoomState(current.id, current.version, newState, extraColumns);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      current = await fetchRoomById(room.id);
      if (!current) throw e;
    }
  }
  throw new ConflictError();
}

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Repli pour les navigateurs plus anciens (Safari < 15.4, certains navigateurs
  // intégrés à des applis) où crypto.randomUUID n'existe pas encore.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const PROFILE_KEY = 'cartes-familiales:profile';

/** Identité locale (prénom + id stable) mémorisée sur cet appareil, une fois pour toutes. */
export function getLocalProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveLocalProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** Première connexion sur cet appareil : crée et mémorise l'identité locale (le salon se choisit séparément, une fois sur l'écran des salons). */
export function createLocalIdentity(name) {
  const profile = { id: uuid(), name };
  saveLocalProfile(profile);
  return profile;
}

/** Change le prénom mémorisé sur cet appareil, et le répercute sur la table si on y est déjà. */
export async function renameLocalPlayer(room, profile, newName) {
  const updatedProfile = { ...profile, name: newName };
  saveLocalProfile(updatedProfile);

  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (!fresh.state.players.some((p) => p.id === profile.id)) return { room: fresh, player: updatedProfile };

    const newState = {
      ...fresh.state,
      players: fresh.state.players.map((p) => (p.id === profile.id ? { ...p, name: newName } : p))
    };

    try {
      const updated = await updateRoomState(fresh.id, fresh.version, newState);
      return { room: updated, player: updatedProfile };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de changer le prénom, réessaie.');
}

function emptyLobbyState() {
  return {
    status: 'lobby',
    players: [],
    hostId: null,
    hostLastSeen: null,
    turnOrder: [],
    currentPlayerId: null,
    oddCardId: null,
    loserId: null,
    lastDraw: null,
    log: [{ ts: Date.now(), message: 'Table ouverte.' }]
  };
}

// Noms de salons (avec emoji assorti) attribués au hasard à la création —
// permet de différencier les salons dans la liste sans avoir à les nommer
// soi-même. Rangé dans `state.roomName`/`state.roomEmoji` plutôt qu'une
// colonne dédiée, pour ne pas avoir à toucher au schéma Supabase.
const ROOM_NAME_POOL = [
  { name: 'Renard', emoji: '🦊' },
  { name: 'Panda', emoji: '🐼' },
  { name: 'Loutre', emoji: '🦦' },
  { name: 'Hibou', emoji: '🦉' },
  { name: 'Koala', emoji: '🐨' },
  { name: 'Dauphin', emoji: '🐬' },
  { name: 'Manchot', emoji: '🐧' },
  { name: 'Hérisson', emoji: '🦔' },
  { name: 'Ours', emoji: '🐻' },
  { name: 'Loup', emoji: '🐺' },
  { name: 'Lapin', emoji: '🐰' },
  { name: 'Perroquet', emoji: '🦜' },
  { name: 'Kangourou', emoji: '🦘' },
  { name: 'Tigre', emoji: '🐯' },
  { name: 'Lion', emoji: '🦁' },
  { name: 'Zèbre', emoji: '🦓' },
  { name: 'Girafe', emoji: '🦒' },
  { name: 'Écureuil', emoji: '🐿️' },
  { name: 'Faucon', emoji: '🦅' },
  { name: 'Pieuvre', emoji: '🐙' }
];

/**
 * Choisit un nom encore libre parmi les salons actuellement listés (le but
 * du nom est de pouvoir désigner un salon précis pour le rejoindre — un
 * doublon rendrait ça ambigu). Repli sur un nom au hasard, doublon possible,
 * si les 20 sont déjà pris (ne devrait pas arriver à l'échelle familiale).
 * Reste une vérification "au mieux" : deux créations simultanées sur deux
 * appareils pourraient en théorie choisir le même nom, comme partout
 * ailleurs dans ce fichier (verrou optimiste par salon, pas de verrou global).
 */
async function pickAvailableRoomName() {
  const rows = await listRooms();
  const takenNames = new Set(rows.map((r) => r.state.roomName).filter(Boolean));
  const free = ROOM_NAME_POOL.filter((n) => !takenNames.has(n.name));
  const pool = free.length ? free : ROOM_NAME_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Salons actifs pour l'écran "salons" — projection minimale (jamais les mains, même si RLS permettrait de lire `state` en entier, voir README "Limite connue"). */
export async function listActiveRooms() {
  const rows = await listRooms();
  return rows.map((row) => ({
    id: row.id,
    game: row.game,
    status: row.state.status,
    roomName: row.state.roomName || 'Salon',
    roomEmoji: row.state.roomEmoji || '🎲',
    players: (row.state.players || []).map((p) => ({ name: p.name, isBot: p.isBot || false })),
    updatedAt: row.updated_at
  }));
}

/**
 * Crée un nouveau salon vide (salle d'attente), avec un nom encore libre
 * pour le désigner sans ambiguïté dans la liste des salons. `defaultGame`
 * fournie par engine.js (le premier jeu du registre découvert dynamiquement)
 * — core.js n'a pas connaissance des jeux disponibles.
 */
export async function createNewRoom(defaultGame) {
  const { name, emoji } = await pickAvailableRoomName();
  const state = { ...emptyLobbyState(), roomName: name, roomEmoji: emoji };
  return createRoom(state, defaultGame);
}

/**
 * Change tout au plus une entrée de `players` : `id` (le bot qui reprend
 * l'identité de la personne) et references croisées (`hostId`,
 * `currentPlayerId`, `turnOrder`, `connections`) qui pointaient vers l'ancien
 * id. Utilisé quand on reprend la place d'un bot qui portait notre nom sur un
 * autre appareil (voir `ensureMembership`) — le `hand`/`grid`/`score`, etc.
 * du joueur restent inchangés puisqu'ils vivent sur l'entrée `players`
 * elle-même, pas dans une structure séparée indexée par id.
 */
function reassignPlayerId(state, oldId, newId) {
  return {
    ...state,
    players: state.players.map((p) => (p.id === oldId ? { ...p, id: newId } : p)),
    hostId: state.hostId === oldId ? newId : state.hostId,
    currentPlayerId: state.currentPlayerId === oldId ? newId : state.currentPlayerId,
    turnOrder: (state.turnOrder || []).map((id) => (id === oldId ? newId : id)),
    connections: state.connections
      ? Object.fromEntries(Object.entries(state.connections).map(([id, v]) => [id === oldId ? newId : id, v]))
      : state.connections
  };
}

/**
 * S'assure que le profil local fait partie des joueurs de la table. Idempotent
 * si déjà membre actif. Gère aussi la reprise de contrôle :
 * - **Même appareil** (notre id est déjà dans `players`, mais marqué `isBot`
 *   — on avait été remplacé après un départ en pleine partie) : on redevient
 *   humain sur cette même entrée.
 * - **Autre appareil / identité recréée**, partie en cours ou terminée : si
 *   un bot présent porte notre nom ET a le marqueur `replacedHuman` (posé
 *   uniquement quand un humain est remplacé après un départ — jamais sur un
 *   bot ajouté volontairement via `addBot`, pour ne pas voler sa place par
 *   simple coïncidence de prénom), on reprend cette place plutôt que de
 *   rester spectateur.
 * - Sinon, partie en cours : mode spectateur (lecture seule).
 * - Sinon (salle d'attente ou manche terminée, aucun bot à reprendre) : ajout
 *   classique comme nouveau joueur.
 */
export async function ensureMembership(room, profile) {
  const existing = room.state.players.find((p) => p.id === profile.id);
  if (existing && !existing.isBot) return room;

  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    const mine = fresh.state.players.find((p) => p.id === profile.id);

    if (mine && !mine.isBot) return fresh;

    if (mine && mine.isBot) {
      const newState = {
        ...fresh.state,
        players: fresh.state.players.map((p) => (p.id === profile.id ? { ...p, isBot: false, replacedHuman: false, lastSeen: Date.now() } : p)),
        log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} reprend sa place.` }]
      };
      try {
        return await updateRoomState(fresh.id, fresh.version, newState);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        continue;
      }
    }

    if (fresh.state.status !== 'lobby') {
      const botMatch = fresh.state.players.find((p) => p.isBot && p.replacedHuman && p.name === profile.name);
      if (botMatch) {
        const reassigned = reassignPlayerId(fresh.state, botMatch.id, profile.id);
        const newState = {
          ...reassigned,
          players: reassigned.players.map((p) => (p.id === profile.id ? { ...p, isBot: false, replacedHuman: false, lastSeen: Date.now() } : p)),
          log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} reprend la place du bot qui le remplaçait.` }]
        };
        try {
          return await updateRoomState(fresh.id, fresh.version, newState);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          continue;
        }
      }
      // Toute partie deja lancee (playing, last_turns, finished) : spectateur.
      return fresh;
    }

    const becomesHost = !fresh.state.hostId;
    const newState = {
      ...fresh.state,
      hostId: fresh.state.hostId || profile.id,
      hostLastSeen: becomesHost ? Date.now() : fresh.state.hostLastSeen,
      players: [...fresh.state.players, { id: profile.id, name: profile.name, hand: [], lastSeen: Date.now() }],
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} a rejoint la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de rejoindre la table, réessaie.');
}

/**
 * Un spectateur (partie déjà lancée, profil absent de `state.players`) prend
 * la place d'un bot précis plutôt que de rester simple observateur — offert
 * par la vue spectateur dès qu'au moins un bot est présent (voir
 * renderSpectatorGame). Renomme l'entrée avec le vrai prénom du joueur : à la
 * différence de la reprise de contrôle de `ensureMembership` (même nom déjà),
 * ici l'identité change vraiment.
 */
export async function replaceBotWithPlayer(room, botId, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    const bot = fresh.state.players.find((p) => p.id === botId);
    if (!bot || !bot.isBot) throw new Error("Ce bot n'est plus disponible — réessaie.");

    const reassigned = reassignPlayerId(fresh.state, botId, profile.id);
    const newState = {
      ...reassigned,
      players: reassigned.players.map((p) =>
        p.id === profile.id ? { ...p, name: profile.name, isBot: false, replacedHuman: false, lastSeen: Date.now() } : p
      ),
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} prend la place de ${bot.name}.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de remplacer ce bot, réessaie.');
}

/** Choisit le nouvel hôte parmi les joueurs restants : toujours un humain en priorité (un bot ne peut pas cliquer sur "Lancer la partie"). */
function pickNewHost(remainingPlayers) {
  const human = remainingPlayers.find((p) => !p.isBot);
  return human?.id || remainingPlayers[0]?.id || null;
}

/**
 * Calcule l'état du salon après le départ (volontaire ou constaté par
 * inactivité — voir `reclaimStalePlayers`) d'un joueur donné, sans effectuer
 * l'écriture elle-même. Centralise les règles pour que `leaveTable` et le
 * repli sur inactivité appliquent exactement le même sort :
 * - **Plus aucun humain ne resterait** (que des bots, ou personne) : le
 *   salon n'a plus de raison d'exister → fermeture (`closeRoom: true`).
 * - **L'hôte part en pleine partie** : le perdre casserait la table pour
 *   tout le monde (relais WebRTC, voir webrtc/relay.js) — la manche est
 *   interrompue, tout le monde retourne en salle d'attente avec un nouvel
 *   hôte humain. Les bots qui ne faisaient que remplacer un humain absent
 *   (`replacedHuman`) sont purgés au passage : ils ne représentent personne
 *   dans une salle d'attente.
 * - **Un autre joueur part en pleine partie** : remplacé par un bot à sa
 *   place (marqué `replacedHuman` pour pouvoir le reprendre plus tard, voir
 *   `ensureMembership`), pour ne pas bloquer les autres.
 * - **Hors partie** (salle d'attente ou manche terminée) : retrait complet
 *   classique.
 */
function computeLeaveOutcome(state, leavingId, leavingName, reasonSuffix = '') {
  const remainingHumans = state.players.filter((p) => p.id !== leavingId && !p.isBot);
  if (remainingHumans.length === 0) {
    return { closeRoom: true };
  }

  const isMidGame = state.status !== 'lobby' && state.status !== 'finished';
  const suffix = reasonSuffix ? ` (${reasonSuffix})` : '';

  if (isMidGame && state.hostId === leavingId) {
    const remainingPlayers = state.players.filter((p) => p.id !== leavingId && !p.replacedHuman);
    return {
      closeRoom: false,
      newState: {
        ...state,
        status: 'lobby',
        players: remainingPlayers.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot || false, hand: [], lastSeen: p.lastSeen })),
        hostId: pickNewHost(remainingPlayers),
        hostLastSeen: Date.now(),
        turnOrder: [],
        currentPlayerId: null,
        log: [...state.log, { ts: Date.now(), message: `${leavingName} (hôte) a quitté${suffix} — partie interrompue, retour à la salle d'attente.` }].slice(-40)
      }
    };
  }

  if (isMidGame) {
    return {
      closeRoom: false,
      newState: {
        ...state,
        players: state.players.map((p) => (p.id === leavingId ? { ...p, isBot: true, replacedHuman: true } : p)),
        log: [...state.log, { ts: Date.now(), message: `${leavingName} a quitté en pleine partie${suffix} — remplacé·e par un bot.` }]
      }
    };
  }

  const remainingPlayers = state.players.filter((p) => p.id !== leavingId);
  const hostChanged = state.hostId === leavingId;
  return {
    closeRoom: false,
    newState: {
      ...state,
      players: remainingPlayers,
      hostId: hostChanged ? pickNewHost(remainingPlayers) : state.hostId,
      hostLastSeen: hostChanged ? Date.now() : state.hostLastSeen,
      log: [...state.log, { ts: Date.now(), message: `${leavingName} a quitté la table${suffix}.` }]
    }
  };
}

/**
 * Un joueur ne peut être membre que d'un seul salon à la fois. Avant de
 * rejoindre/créer un salon, on le retire de tout autre salon où il
 * apparaîtrait encore dans `state.players` (ex: onglet resté ouvert sur une
 * ancienne table). Recherche par id de profil sur les salons actifs, pas
 * seulement sur la référence locale de l'onglet courant — couvre aussi le
 * cas multi-onglets/multi-appareils avec le même profil.
 */
export async function leaveOtherRooms(profile, exceptRoomId) {
  const rows = await listRooms(100);
  const others = rows.filter((row) => row.id !== exceptRoomId && row.state.players.some((p) => p.id === profile.id));
  for (const row of others) {
    try {
      await leaveTable({ id: row.id }, profile);
    } catch (e) {
      // Pas grave si ça échoue (ex: salon déjà fermé entre-temps) — on continue.
    }
  }
}

/**
 * Salon où ce profil est déjà membre (humain actif, ou remplacé par un bot
 * après un départ en pleine partie/une déconnexion — voir `computeLeaveOutcome`),
 * s'il y en a un. Utilisé au démarrage de l'appli pour reprendre directement
 * sa place plutôt que de repasser par l'écran des salons — un joueur n'étant
 * jamais membre que d'un seul salon à la fois (voir `leaveOtherRooms`), le
 * premier trouvé suffit. `null` si aucun (première visite, ou a quitté
 * explicitement une salle d'attente — ce départ-ci retire l'entrée pour de
 * bon, contrairement à un départ en pleine partie).
 */
export async function findMyRoom(profile) {
  const rows = await listRooms(100);
  return rows.find((row) => row.state.players.some((p) => p.id === profile.id)) || null;
}

export async function leaveTable(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (!fresh.state.players.some((p) => p.id === profile.id)) return fresh; // déjà parti

    const outcome = computeLeaveOutcome(fresh.state, profile.id, profile.name);
    if (outcome.closeRoom) {
      await deleteRoom(fresh.id);
      return null;
    }

    try {
      return await updateRoomState(fresh.id, fresh.version, outcome.newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de quitter la table, réessaie.');
}

/**
 * Retire un joueur donné de la table (utilisé par l'hôte pour quelqu'un qui a
 * oublié de quitter). Mêmes garde-fous que leaveTable : impossible en pleine partie.
 */
export async function kickPlayer(room, targetId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    const target = fresh.state.players.find((p) => p.id === targetId);
    if (!target) return fresh; // déjà parti
    if (fresh.state.status === 'playing' || fresh.state.status === 'exchange') {
      throw new Error('Impossible de retirer un joueur en pleine partie.');
    }

    const remainingPlayers = fresh.state.players.filter((p) => p.id !== targetId);
    const hostChanged = fresh.state.hostId === targetId;
    const newHostId = hostChanged ? pickNewHost(remainingPlayers) : fresh.state.hostId;
    const newState = {
      ...fresh.state,
      players: remainingPlayers,
      hostId: newHostId,
      hostLastSeen: hostChanged ? Date.now() : fresh.state.hostLastSeen,
      log: [...fresh.state.log, { ts: Date.now(), message: `${target.name} a été retiré de la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de retirer ce joueur, réessaie.');
}

const BOT_FIRST_NAMES = [
  'Camille', 'Léo', 'Manon', 'Hugo', 'Chloé', 'Nathan', 'Louise', 'Théo',
  'Emma', 'Lucas', 'Jade', 'Gabriel', 'Alice', 'Raphaël', 'Inès', 'Adam'
];

function pickBotName(existingPlayers) {
  const takenNames = new Set(existingPlayers.map((p) => p.name));
  const free = BOT_FIRST_NAMES.filter((n) => !takenNames.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const botNumber = existingPlayers.filter((p) => p.isBot).length + 1;
  return `Bot ${botNumber}`;
}

/** Ajoute un bot à la table (hôte uniquement, en salle d'attente). Limité à 6 joueurs au total. */
export async function addBot(room) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible d'ajouter un bot en pleine partie.");
    if (fresh.state.players.length >= 6) throw new Error('Table complète (6 joueurs maximum).');

    const botName = pickBotName(fresh.state.players);
    const newState = {
      ...fresh.state,
      players: [...fresh.state.players, { id: `bot-${uuid()}`, name: botName, isBot: true, hand: [] }],
      log: [...fresh.state.log, { ts: Date.now(), message: `${botName} rejoint la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error("Impossible d'ajouter un bot, réessaie.");
}

// Au bout de ce délai sans nouvelles de l'hôte (en salle d'attente), n'importe
// qui peut reprendre la main automatiquement au prochain chargement de l'appli.
export const HOST_STALE_MS = 2 * 60 * 1000;

function isHostStale(state) {
  if (!state.hostId) return false;
  return Date.now() - (state.hostLastSeen || 0) > HOST_STALE_MS;
}

/**
 * Permet à un humain de reprendre le rôle d'hôte si celui-ci est actuellement
 * un bot, ou un humain inactif depuis plus de 2 minutes. Porte de sortie pour
 * ne pas rester bloqué si l'hôte a disparu sans prévenir.
 */
export async function claimHost(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible de changer d'hôte en pleine partie.");
    if (!fresh.state.players.some((p) => p.id === profile.id)) throw new Error("Tu n'es pas (encore) à cette table.");

    const currentHost = fresh.state.players.find((p) => p.id === fresh.state.hostId);
    if (currentHost && !currentHost.isBot && !isHostStale(fresh.state)) {
      throw new Error('Il y a déjà un hôte actif à la table.');
    }

    const newState = {
      ...fresh.state,
      hostId: profile.id,
      hostLastSeen: Date.now(),
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} devient l'hôte.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error("Impossible de devenir l'hôte, réessaie.");
}

/**
 * Reprise automatique et silencieuse : appelée à chaque chargement/reconnexion.
 * Si l'hôte est un bot ou n'a plus donné signe de vie depuis plus de 2 minutes,
 * la première personne qui charge l'appli devient hôte sans avoir à cliquer sur
 * quoi que ce soit. Ne fait rien si l'hôte est déjà cette personne, ou actif.
 */
export async function reclaimStaleHost(room, profile) {
  if (room.state.status !== 'lobby') return room;
  if (room.state.hostId === profile.id) return room;
  if (!room.state.players.some((p) => p.id === profile.id)) return room;

  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status !== 'lobby') return fresh;
    if (fresh.state.hostId === profile.id) return fresh;

    const currentHost = fresh.state.players.find((p) => p.id === fresh.state.hostId);
    const shouldReclaim = !currentHost || currentHost.isBot || isHostStale(fresh.state);
    if (!shouldReclaim) return fresh;

    const newState = {
      ...fresh.state,
      hostId: profile.id,
      hostLastSeen: Date.now(),
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} devient l'hôte (ancien hôte inactif).` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  return room; // pas grave si ça échoue, ça retentera au prochain chargement
}

/** Battement de cœur : l'hôte signale sa présence pendant qu'il est en salle d'attente. */
export async function pingHostPresence(room, profile) {
  if (room.state.hostId !== profile.id) return room;
  if (room.state.status !== 'lobby') return room;
  try {
    return await updateRoomState(room.id, room.version, { ...room.state, hostLastSeen: Date.now() });
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

/**
 * Battement de cœur de n'importe quel joueur (pas seulement l'hôte), dans
 * n'importe quel statut de salon — contrairement à `pingHostPresence`,
 * l'abandon silencieux peut arriver en pleine partie, pas seulement en salle
 * d'attente. Alimente `reclaimStalePlayers`.
 */
export async function pingPlayerPresence(room, profile) {
  const me = room.state.players.find((p) => p.id === profile.id);
  if (!me) return room;
  // Évite de faire monter `version` trop souvent (sinon conflits sur les coups).
  if (me.lastSeen && Date.now() - me.lastSeen < 25000) return room;
  try {
    return await updateRoomState(room.id, room.version, {
      ...room.state,
      players: room.state.players.map((p) => (p.id === profile.id ? { ...p, lastSeen: Date.now() } : p))
    });
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

// Délai de base d'inactivité par humain présent (× nombre d'humains).
// Ex. 2 humains → 2 min, 4 humains → 4 min. Les bots ne comptent pas.
export const PLAYER_STALE_MS_PER_HUMAN = 60 * 1000;
/** Conservé pour compat : équivalent à 2 humains. Préférer `playerStaleMs(state)`. */
export const PLAYER_STALE_MS = 2 * PLAYER_STALE_MS_PER_HUMAN;

/** Délai avant remplacement par un bot : 1 minute × nombre d'humains dans le salon. */
export function playerStaleMs(state) {
  const humans = (state.players || []).filter((p) => !p.isBot).length;
  return Math.max(1, humans) * PLAYER_STALE_MS_PER_HUMAN;
}

function isPlayerStale(p, state) {
  if (p.isBot || !p.lastSeen) return false; // pas de battement reçu pour l'instant : pas de verdict prématuré.
  return Date.now() - p.lastSeen > playerStaleMs(state);
}

/**
 * Repli passif pour l'abandon silencieux (onglet fermé sans cliquer
 * "quitter") : n'importe quel appareil actif dans un salon vérifie
 * périodiquement si un AUTRE joueur n'a plus donné signe de vie depuis
 * `playerStaleMs` (1 min × nb d'humains), et lui applique alors le même sort qu'un
 * départ volontaire — voir `computeLeaveOutcome`, partagée avec `leaveTable`.
 * Ne traite qu'un joueur à la fois (au prochain battement, le suivant sera
 * traité) pour rester simple face aux écritures concurrentes.
 *
 * Un joueur sans `lastSeen` (salon créé avant ce mécanisme, ou avant même sa
 * toute première seconde d'existence) n'est PAS pour autant immunisé pour
 * toujours : on lui amorce un `lastSeen` fraîchement daté dès qu'on le
 * remarque (ce passage-ci ne le considère pas encore inactif — délai de
 * grâce), pour qu'il redevienne un candidat normal après le délai dynamique s'il
 * ne s'est toujours pas manifesté. Sans ça, un joueur disparu avant même le
 * déploiement de ce mécanisme resterait un fantôme définitivement protégé.
 */
export async function reclaimStalePlayers(room, profile) {
  const suspect = room.state.players.find((p) => p.id !== profile.id && isPlayerStale(p, room.state));
  const needsBootstrap = room.state.players.find((p) => p.id !== profile.id && !p.isBot && !p.lastSeen);
  if (!suspect && !needsBootstrap) return room;

  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await fetchRoomById(room.id);

    const toBootstrap = fresh.state.players.filter((p) => p.id !== profile.id && !p.isBot && !p.lastSeen);
    if (toBootstrap.length) {
      const bootstrappedIds = new Set(toBootstrap.map((p) => p.id));
      const newState = {
        ...fresh.state,
        players: fresh.state.players.map((p) => (bootstrappedIds.has(p.id) ? { ...p, lastSeen: Date.now() } : p))
      };
      try {
        return await updateRoomState(fresh.id, fresh.version, newState);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        continue;
      }
    }

    const target = fresh.state.players.find((p) => p.id !== profile.id && isPlayerStale(p, fresh.state));
    if (!target || target.isBot) return fresh; // quelqu'un d'autre s'en est déjà occupé, ou reconnecté

    const staleMin = Math.round(playerStaleMs(fresh.state) / 60000);
    const outcome = computeLeaveOutcome(fresh.state, target.id, target.name, `inactif depuis plus de ${staleMin} minute${staleMin > 1 ? 's' : ''}`);
    if (outcome.closeRoom) {
      // Ne devrait pas arriver ici : `profile` est forcément un humain actif
      // et compte donc parmi les humains restants — filet de sécurité si
      // jamais le raisonnement change un jour.
      await deleteRoom(fresh.id);
      return null;
    }

    try {
      return await updateRoomState(fresh.id, fresh.version, outcome.newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  return room; // pas grave, retentera au prochain battement
}

/**
 * Lance la partie. `gameModules` (fourni par engine.js) mappe chaque id de
 * jeu vers son module `<id>.js` complet (initGame, meta, et éventuellement
 * `validatePlayerCount` — voir trouduc.js pour un exemple où le nombre de
 * joueurs requis est fixe plutôt qu'une plage min/max générique).
 */
export async function startGame(room, gameType, gameModules) {
  const mod = gameModules[gameType];
  if (!mod) throw new Error('Jeu inconnu.');

  if (mod.validatePlayerCount) {
    mod.validatePlayerCount(room.state.players);
  } else {
    const minPlayers = mod.meta?.minPlayers ?? 2;
    if (room.state.players.length < minPlayers) {
      throw new Error(`Il faut au moins ${minPlayers} joueur${minPlayers > 1 ? 's' : ''}.`);
    }
    if (mod.meta?.maxPlayers && room.state.players.length > mod.meta.maxPlayers) {
      throw new Error(`${mod.meta.label} se joue au maximum à ${mod.meta.maxPlayers} joueurs.`);
    }
  }

  // `bet` (Blackjack) est réglé par chacun dans le lobby via setBlackjackBet, et
  // déjà présent sur l'entrée du joueur — on le transmet, ignoré par les autres jeux.
  const playersList = room.state.players.map(({ id, name, isBot, bet }) => ({ id, name, isBot, bet }));
  const gameState = mod.initGame(playersList);
  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState, { game: gameType });
}

/**
 * Enchaîne directement une nouvelle manche du même jeu, avec les mêmes
 * joueurs, **sans repasser par le lobby** — et en conservant le contexte
 * propre à chaque jeu (rôles du Trou du Cul, argent du Blackjack). Seulement
 * disponible une fois la manche/partie précédente terminée. Si le module du
 * jeu exporte `continueRound(room, playersList)`, il est utilisé à la place
 * du simple `initGame(playersList)` générique — voir trouduc.js/blackjack.js/
 * flip7.js/skyjo.js/cinqrois.js pour les cas où le contexte doit être reconduit.
 */
export async function continueGame(room, gameModules) {
  if (room.state.status !== 'finished') {
    throw new Error("La manche en cours n'est pas terminée.");
  }

  const mod = gameModules[room.game];
  if (!mod) throw new Error('Jeu inconnu.');

  const playersList = room.state.players.map(({ id, name, isBot, bet }) => ({ id, name, isBot, bet }));
  const gameState = mod.continueRound ? mod.continueRound(room, playersList) : mod.initGame(playersList);

  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState, { game: room.game });
}

/**
 * Remet la table en salle d'attente — **réinitialise le contexte de la partie**
 * (rôles du Trou du Cul retirés au sort à la prochaine donne, argent du
 * Blackjack remis à `STARTING_MONEY`, score de Flip 7/Skyjo remis à 0)
 * puisqu'on quitte volontairement la partie en cours. Pour enchaîner une
 * manche en conservant ce contexte, voir `continueGame`.
 */
export async function playAgain(room) {
  // Les bots qui ne faisaient que remplacer un humain parti (`replacedHuman`)
  // n'ont rien à faire dans une salle d'attente — seuls les vrais joueurs
  // (humains, ou bots ajoutés volontairement via `addBot`) y retournent.
  const players = room.state.players
    .filter((p) => !p.replacedHuman)
    .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot || false, lastSeen: p.lastSeen }));

  const newState = {
    ...room.state,
    status: 'lobby',
    players: players.map((p) => ({ ...p, hand: [] })),
    hostId: room.state.hostId,
    hostLastSeen: Date.now(),
    turnOrder: [],
    currentPlayerId: null,
    log: [...room.state.log, { ts: Date.now(), message: 'Retour à la salle d\'attente — nouvelle partie.' }].slice(-40)
  };
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Signale si CET appareil bénéficie actuellement d'une liaison directe
 * (WebRTC) vers l'hôte — poussé régulièrement par `main.js` (voir
 * `isRelayActive`) pour que l'indicateur 🔌 soit visible par tout le monde à
 * côté du prénom concerné, pas seulement sur l'appareil de la personne
 * connectée. Rangé à part dans `room.state.connections` (et non sur l'entrée
 * du joueur dans `players`) pour survivre aux changements de forme des
 * joueurs d'un jeu à l'autre (`startGame`/`continueGame` ne recopient que
 * `{id, name, isBot, bet}` depuis le lobby). Non critique : en cas de
 * conflit d'écriture, on laisse simplement le prochain passage de
 * `main.js` (quelques secondes plus tard) corriger l'état.
 */
export async function reportRelayStatus(room, playerId, active) {
  try {
    const fresh = await fetchRoomById(room.id);
    if (Boolean(fresh.state.connections?.[playerId]) === active) return fresh;
    const newState = { ...fresh.state, connections: { ...fresh.state.connections, [playerId]: active } };
    return await updateRoomState(fresh.id, fresh.version, newState);
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

export function watchRoom(roomId, onChange) {
  return subscribeRoom(roomId, onChange);
}
