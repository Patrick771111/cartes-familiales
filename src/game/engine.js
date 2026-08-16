// Point d'assemblage : découvre dynamiquement tous les jeux (src/game/<id>.js,
// chacun exportant au minimum `initGame` + `meta`, et ses propres wrappers
// d'action) et les combine avec les mécaniques transverses de core.js
// (salons, présence, hôte). Ajouter un jeu = ajouter son fichier <id>.js
// (+ <id>.bot.js, <id>.rules.js, src/ui/games/<id>.js) — rien à modifier ici
// (voir "Ajouter un jeu" dans README.md).
import * as core from './core.js';

export {
  ConflictError,
  fetchRoomById,
  initRelay,
  isRelayActive,
  stopRelay,
  getLocalProfile,
  createLocalIdentity,
  renameLocalPlayer,
  listActiveRooms,
  ensureMembership,
  leaveTable,
  kickPlayer,
  addBot,
  claimHost,
  reclaimStaleHost,
  pingHostPresence,
  pingPlayerPresence,
  reclaimStalePlayers,
  playAgain,
  reportRelayStatus,
  watchRoom,
  HOST_STALE_MS,
  PLAYER_STALE_MS,
  PLAYER_STALE_MS_PER_HUMAN,
  playerStaleMs
} from './core.js';

// Modules `<id>.js` de chaque jeu. `engine.js`/`core.js` explicitement
// exclus (pas de self-import) ; le filtre ci-dessous (présence de `meta` +
// `initGame`) écarte de toute façon `deck.js` et les futurs `.bot.js`/
// `.rules.js`/`.ui.js`, qui n'exportent pas cette forme.
const gameModules = import.meta.glob(['./*.js', '!./engine.js', '!./core.js'], { eager: true });

const GAME_INITIALIZERS = {};
const AVAILABLE_GAMES_LIST = [];
for (const path in gameModules) {
  const mod = gameModules[path];
  if (!mod.meta || typeof mod.initGame !== 'function') continue; // core.js, deck.js, etc. — pas un jeu
  GAME_INITIALIZERS[mod.meta.id] = mod;
  AVAILABLE_GAMES_LIST.push(mod.meta);
}
AVAILABLE_GAMES_LIST.sort((a, b) => a.label.localeCompare(b.label, 'fr'));

export const AVAILABLE_GAMES = AVAILABLE_GAMES_LIST;
const DEFAULT_GAME = AVAILABLE_GAMES_LIST.find((g) => g.id === 'pouilleux')?.id || AVAILABLE_GAMES_LIST[0]?.id;

/**
 * `playerCount` permet-il de lancer `gameId` ? Même règle que `startGame`
 * (`validatePlayerCount` custom si le jeu en définit un — ex. trouduc.js,
 * "exactement 4" — sinon min/max de `meta`), réutilisée par le sélecteur de
 * jeu pour griser les jaquettes incompatibles avec l'effectif actuel.
 */
export function playerCountAllowed(gameId, playerCount) {
  const mod = GAME_INITIALIZERS[gameId];
  if (!mod) return true;
  if (mod.validatePlayerCount) {
    try {
      mod.validatePlayerCount(Array.from({ length: playerCount }));
      return true;
    } catch {
      return false;
    }
  }
  const minPlayers = mod.meta?.minPlayers ?? 2;
  if (playerCount < minPlayers) return false;
  if (mod.meta?.maxPlayers && playerCount > mod.meta.maxPlayers) return false;
  return true;
}

/** Crée un nouveau salon vide (salle d'attente) sur le premier jeu disponible. */
export async function createNewRoom() {
  return core.createNewRoom(DEFAULT_GAME);
}

export async function startGame(room, gameType = DEFAULT_GAME) {
  return core.startGame(room, gameType, GAME_INITIALIZERS);
}

export async function continueGame(room) {
  return core.continueGame(room, GAME_INITIALIZERS);
}

// Les wrappers d'action de chaque jeu (ex. drawForCurrentPlayer, playCards…)
// vivent désormais directement dans leur src/game/<id>.js (voir "Ajouter un
// jeu" dans README.md) — src/ui/games/<id>.js les importe depuis là, pas
// d'ici. Ce fichier n'assemble plus que le registre + les mécaniques
// transverses de core.js.
