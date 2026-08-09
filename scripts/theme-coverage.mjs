#!/usr/bin/env node
// Couverture des illustrations de thème, jeu par jeu.
//
// Lit `ILLUSTRATION_SLOTS` (voir README.md, "Thèmes de cartes") exporté par
// chaque src/game/<id>.js, et le compare au contenu réel de
// src/assets/cards/<theme>/games/<id>/. Pour chaque slot : ✅ dessin dédié,
// 🟡 pris dans le pool générique du jeu, ⬜ rien (le thème reste sobre).
//
// Pur texte (regex + un mini-scanner d'accolades) plutôt qu'un `import()`
// des fichiers de jeu : ceux-ci importent `./core.js`, qui importe la vraie
// couche Supabase (`import.meta.env`, `@supabase/supabase-js`) — un import
// direct planterait en Node nu, hors Vite. Aucun risque à évaluer les objets
// extraits : ce sont nos propres fichiers sources, jamais une entrée
// utilisateur.
//
// Usage : node scripts/theme-coverage.mjs   (ou `npm run theme:coverage`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GAME_DIR = join(ROOT, 'src', 'game');
const CARDS_DIR = join(ROOT, 'src', 'assets', 'cards');

const THEME_FOLDER_TO_ID = { 'auto-brands': 'autoBrands', mascotte: 'mascotte' };

function listGameFiles() {
  return readdirSync(GAME_DIR).filter(
    (f) => f.endsWith('.js') && !f.endsWith('.bot.js') && !f.endsWith('.rules.js') && f !== 'engine.js' && f !== 'core.js' && f !== 'deck.js'
  );
}

/** Extrait le texte d'un objet littéral `{ ... }` à partir de l'index du `{` d'ouverture, en respectant les chaînes (', ", `) pour ne pas mécompter les accolades qu'elles contiendraient. */
function extractBalancedObject(text, openBraceIndex) {
  let depth = 0;
  let inString = null;
  for (let i = openBraceIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

/** Résout `ILLUSTRATION_SLOTS` pour un fichier de jeu : littéral `[...]`, ou `Object.keys(NAME)` avec `NAME` défini plus haut dans le même fichier. Retourne `null` si le jeu n'exporte pas ce manifeste (pas de slots à vérifier). */
function readIllustrationSlots(fileText) {
  const exportMatch = fileText.match(/export const ILLUSTRATION_SLOTS\s*=\s*(.+?);/);
  if (!exportMatch) return null;
  const rhs = exportMatch[1].trim();

  const arrayMatch = rhs.match(/^\[[\s\S]*\]$/);
  if (arrayMatch) {
    return new Function(`return ${rhs}`)();
  }

  const keysMatch = rhs.match(/^Object\.keys\((\w+)\)$/);
  if (keysMatch) {
    const name = keysMatch[1];
    const defMatch = fileText.match(new RegExp(`export const ${name}\\s*=\\s*(\\{)`));
    if (!defMatch) throw new Error(`ILLUSTRATION_SLOTS référence ${name}, introuvable dans le même fichier.`);
    const openIdx = defMatch.index + defMatch[0].length - 1;
    const objText = extractBalancedObject(fileText, openIdx);
    if (!objText) throw new Error(`Accolades non équilibrées en extrayant ${name}.`);
    const obj = new Function(`return ${objText}`)();
    return Object.keys(obj);
  }

  throw new Error(`Forme d'ILLUSTRATION_SLOTS non reconnue : ${rhs}`);
}

function listThemeFolders() {
  return readdirSync(CARDS_DIR).filter((f) => THEME_FOLDER_TO_ID[f] && statSync(join(CARDS_DIR, f)).isDirectory());
}

function slotStatus(themeFolder, gameId, slotKey) {
  const gameDir = join(CARDS_DIR, themeFolder, 'games', gameId);
  try {
    const dedicated = readdirSync(gameDir).some((f) => f === `${slotKey}.webp`);
    if (dedicated) return '✅ dédié';
  } catch {
    return '⬜ rien';
  }
  try {
    const pool = readdirSync(join(gameDir, '_pool')).filter((f) => f.endsWith('.webp'));
    if (pool.length) return `🟡 pool (${pool.length})`;
  } catch {
    // pas de pool
  }
  return '⬜ rien';
}

function main() {
  const themeFolders = listThemeFolders();
  const gamesWithSlots = [];

  for (const fn of listGameFiles()) {
    const text = readFileSync(join(GAME_DIR, fn), 'utf-8');
    let slots;
    try {
      slots = readIllustrationSlots(text);
    } catch (err) {
      console.error(`⚠️  ${fn} : ${err.message}`);
      continue;
    }
    if (slots) gamesWithSlots.push({ gameId: fn.replace(/\.js$/, ''), slots });
  }

  if (!gamesWithSlots.length) {
    console.log('Aucun jeu n’exporte ILLUSTRATION_SLOTS pour le moment.');
    return;
  }

  for (const { gameId, slots } of gamesWithSlots) {
    console.log(`\n=== ${gameId} (${slots.length} slot${slots.length > 1 ? 's' : ''}) ===`);
    const header = ['slot', ...themeFolders.map((f) => THEME_FOLDER_TO_ID[f])];
    const rows = slots.map((slot) => [slot, ...themeFolders.map((f) => slotStatus(f, gameId, slot))]);
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const printRow = (row) => console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
    printRow(header);
    printRow(widths.map((w) => '-'.repeat(w)));
    rows.forEach(printRow);
  }
  console.log('');
}

main();
