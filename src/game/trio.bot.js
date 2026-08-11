import { fetchRoomById, commitGameAction } from './core.js';
import {
  applyRevealCenter as applyTrioRevealCenter,
  applyRevealRow as applyTrioRevealRow,
  applyConfirmTurn as applyTrioConfirmTurn,
  rowEndCard as trioRowEndCard
} from './trio.js';

function revealTrioCenter(room, playerId, cardId) {
  return commitGameAction(room, (state) => applyTrioRevealCenter(state, playerId, cardId));
}
function revealTrioRow(room, playerId, targetPlayerId, end) {
  return commitGameAction(room, (state) => applyTrioRevealRow(state, playerId, targetPlayerId, end));
}
function confirmTrioTurn(room, playerId) {
  return commitGameAction(room, (state) => applyTrioConfirmTurn(state, playerId));
}

/**
 * Options de révélation légales à l'instant T, avec l'id de la carte
 * concernée (utile pour la mémoire ci-dessous) — même logique que
 * `applyRevealRow`/`applyRevealCenter` côté trio.js, dupliquée en lecture
 * seule pour ne pas coupler le bot aux exceptions serveur.
 */
function legalReveals(state) {
  const options = [];
  for (const c of state.center) {
    if (!c.taken && !state.pendingReveals.some((r) => r.source.cardId === c.id)) {
      options.push({ type: 'center', cardId: c.id });
    }
  }
  for (const p of state.players) {
    const low = trioRowEndCard(p.row, 'low', state.pendingReveals);
    const high = trioRowEndCard(p.row, 'high', state.pendingReveals);
    if (low) options.push({ type: 'row', targetPlayerId: p.id, end: 'low', cardId: low.id });
    if (high && (!low || high.id !== low.id)) options.push({ type: 'row', targetPlayerId: p.id, end: 'high', cardId: high.id });
  }
  return options;
}

function memoryKey(option) {
  return option.type === 'center' ? `center:${option.cardId}` : `row:${option.targetPlayerId}:${option.cardId}`;
}

// Mémoire par salon des cartes déjà vues face visible, qu'importe qui les a
// révélées — la règle du jeu rend toute révélation publique (voir
// `pendingReveals` dans trio.js), donc s'en souvenir n'est pas de la
// triche, juste ce que ferait un joueur humain attentif. Les entrées pour
// des cartes gagnées/retirées restent inertes (elles ne réapparaîtront
// jamais dans `legalReveals`), inutile de les purger.
const cardMemoryByRoom = new Map();

function getMemory(roomId) {
  let memory = cardMemoryByRoom.get(roomId);
  if (!memory) {
    memory = new Map();
    cardMemoryByRoom.set(roomId, memory);
  }
  return memory;
}

function rememberReveals(room) {
  const memory = getMemory(room.id);
  for (const reveal of room.state.pendingReveals || []) {
    const key =
      reveal.source.type === 'center' ? `center:${reveal.source.cardId}` : `row:${reveal.source.playerId}:${reveal.source.cardId}`;
    memory.set(key, reveal.value);
  }
  return memory;
}

function toMove(option) {
  return option.type === 'center'
    ? { type: 'center', cardId: option.cardId }
    : { type: 'row', targetPlayerId: option.targetPlayerId, end: option.end };
}

/**
 * Politique du bot à Trio, à partir de sa mémoire des cartes déjà vues
 * (voir `rememberReveals` — jamais de valeur cachée consultée directement) :
 * - 1ère révélation d'une tentative : s'il connaît 2 cartes actuellement
 *   accessibles de même valeur, il ouvre directement dessus (tente le trio
 *   sans détour) ; sinon il préfère une carte encore inconnue (apprendre
 *   quelque chose) à une carte déjà connue mais isolée (n'apporterait rien).
 * - 2e/3e révélation : cherche en priorité une carte connue de la même
 *   valeur que la 1ère de la tentative (coup sûr) ; à défaut une carte
 *   inconnue (vraie tentative) ; en tout dernier recours une carte connue
 *   d'une AUTRE valeur (échec assuré), seulement si aucune autre option
 *   n'existe.
 */
export function chooseMove(state, botId, memory) {
  if (state.turnOutcome) return { type: 'confirm' };
  const options = legalReveals(state);
  if (!options.length) return { type: 'confirm' }; // filet de sécurité, ne devrait pas arriver en cours de partie

  const withKnowledge = options.map((opt) => {
    const key = memoryKey(opt);
    return { opt, known: memory.has(key), value: memory.get(key) };
  });

  if (state.pendingReveals.length === 0) {
    const byValue = new Map();
    withKnowledge
      .filter((o) => o.known)
      .forEach((o) => {
        if (!byValue.has(o.value)) byValue.set(o.value, []);
        byValue.get(o.value).push(o);
      });
    const knownPair = [...byValue.values()].find((group) => group.length >= 2);
    if (knownPair) return toMove(knownPair[0].opt);

    const unknowns = withKnowledge.filter((o) => !o.known);
    const pool = unknowns.length ? unknowns : withKnowledge;
    return toMove(pool[Math.floor(Math.random() * pool.length)].opt);
  }

  const target = state.pendingReveals[0].value;
  const knownMatch = withKnowledge.find((o) => o.known && o.value === target);
  if (knownMatch) return toMove(knownMatch.opt);

  const unknowns = withKnowledge.filter((o) => !o.known);
  const pool = unknowns.length ? unknowns : withKnowledge;
  return toMove(pool[Math.floor(Math.random() * pool.length)].opt);
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  // Enregistre les révélations publiques de CE tour (même si ce n'est pas
  // un bot qui joue) : chaque client observe ainsi les mêmes cartes qu'un
  // joueur humain attentif verrait passer.
  rememberReveals(room);

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  // Pas de bouton "Continuer" côté joueur (voir src/ui/games/trio.js) : même
  // pause fixe d'une seconde ici quand il ne reste qu'à confirmer le
  // résultat de la tentative — pas besoin de variabilité aléatoire pour ce
  // pas-là, qui ne simule pas une "réflexion" mais juste le temps de lire.
  const delay = room.state.turnOutcome ? 1000 : 700 + Math.random() * 600;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const memory = rememberReveals(fresh);
      const move = chooseMove(fresh.state, currentId, memory);
      if (move.type === 'confirm') {
        await confirmTrioTurn(fresh, currentId);
      } else if (move.type === 'center') {
        await revealTrioCenter(fresh, currentId, move.cardId);
      } else if (move.type === 'row') {
        await revealTrioRow(fresh, currentId, move.targetPlayerId, move.end);
      }
    } catch (err) {
      // Un autre appareil a probablement déjà joué / confirmé.
    }
  }, delay);
}
