import {
  getOrCreateRoomByCode,
  fetchRoomById,
  updateRoomState,
  subscribeRoom,
  ConflictError
} from '../supabase/sync.js';
import { initGame as initPouilleux, applyDraw } from './pouilleux.js';
import { initGame as initTrouduc, applyPlay as applyTrouducPlay, applyPass as applyTrouducPass } from './trouduc.js';

const GAME_INITIALIZERS = {
  pouilleux: initPouilleux,
  trouduc: initTrouduc
};

export const AVAILABLE_GAMES = [
  { id: 'pouilleux', label: 'Le Pouilleux', hint: '2 à 4 joueurs' },
  { id: 'trouduc', label: 'Le Trou du Cul', hint: 'exactement 4 joueurs' }
];

// Code fixe de la table familiale : personne n'a besoin de le saisir ni de le
// partager, tout le monde retombe automatiquement sur la même table.
// Modifiable via VITE_FAMILY_CODE si un jour tu veux plusieurs tables séparées.
const FAMILY_CODE = (import.meta.env.VITE_FAMILY_CODE || 'FAMILLE-BLAVIER').toUpperCase();

const PROFILE_KEY = 'cartes-familiales:profile';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Repli pour les navigateurs plus anciens (Safari < 15.4, certains navigateurs
  // intégrés à des applis) où crypto.randomUUID n'existe pas encore.
