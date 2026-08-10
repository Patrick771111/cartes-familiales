"""
Génère des copies "de test" de tous les fichiers utilisant import.meta.glob
(fonctionnalité Vite, invalide dans un navigateur nu) en remplaçant chaque
appel glob par des imports littéraux + un objet équivalent au résultat que
Vite aurait produit. Permet de tester l'appli dans un navigateur servi en
`python -m http.server`, sans Node/Vite (utile si l'environnement n'a pas
Node disponible).

Ne touche à aucun fichier réel — écrit uniquement des copies `_test_*` à
côté des originaux. Toujours les supprimer après usage (voir cleanup.py).

Usage : python gen_test_bundle.py [chemin_du_repo]
Par défaut, chemin_du_repo = le répertoire courant.

Zéro maintenance attendue : découvre les jeux/thèmes dynamiquement via
listdir, comme le fait l'appli elle-même via import.meta.glob. Ajouter ou
retirer un jeu (ou un thème de cartes) ne demande aucune modification ici.
"""
import os
import sys

REPO = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
os.chdir(REPO)


def assert_marker(content, marker, path):
    assert marker in content, f"{path} : marqueur introuvable -> {marker}\n(le fichier a-t-il changé de forme ? adapter ce script)"


# --- game/*.js (tout sauf engine.js/core.js) : copies repointant './core.js'
# vers sa copie de test là où c'est utilisé (jeux avec wrappers d'action +
# .bot.js), et (pour les .bot.js) leur propre import du fichier <id>.js réel
# vers sa copie de test aussi. Copie verbatim sinon (.rules.js, deck.js). ---
game_files = sorted(
    f for f in os.listdir("src/game")
    if f.endswith(".js") and f not in ("engine.js", "core.js") and not f.startswith("_test_")
)
non_bot_game_files = [f for f in game_files if not f.endswith(".bot.js") and not f.endswith(".rules.js")]
for fn in game_files:
    with open(f"src/game/{fn}", encoding="utf-8") as f:
        content = f.read()
    content = content.replace("from './core.js';", "from './_test_core_copy.js';")
    if fn.endswith(".bot.js"):
        for gfn in non_bot_game_files:
            content = content.replace(f"from './{gfn}';", f"from './_test_{gfn}';")
    with open(f"src/game/_test_{fn}", "w", encoding="utf-8") as f:
        f.write(content)

# --- webrtc/relay.js : copie repointant client.js/sync.js vers les fakes ---
with open("src/webrtc/relay.js", encoding="utf-8") as f:
    relay_content = f.read()
relay_content = relay_content.replace("from '../supabase/client.js';", "from '../supabase/_test_client_fake.js';")
relay_content = relay_content.replace("from '../supabase/sync.js';", "from '../supabase/_test_sync_fake.js';")
with open("src/webrtc/_test_relay_copy.js", "w", encoding="utf-8") as f:
    f.write(relay_content)

# --- game/core.js : copie repointant sync.js/relay.js vers les fakes/copies ---
with open("src/game/core.js", encoding="utf-8") as f:
    core_content = f.read()
core_content = core_content.replace("from '../supabase/sync.js';", "from '../supabase/_test_sync_fake.js';")
core_content = core_content.replace("from '../webrtc/relay.js';", "from '../webrtc/_test_relay_copy.js';")
with open("src/game/_test_core_copy.js", "w", encoding="utf-8") as f:
    f.write(core_content)

# --- engine.js : import.meta.glob(['./*.js', '!./engine.js', '!./core.js']) ---
with open("src/game/engine.js", encoding="utf-8") as f:
    engine_content = f.read()
engine_content = engine_content.replace("from './core.js';", "from './_test_core_copy.js';")

imports = []
entries = []
for i, fn in enumerate(game_files):
    var = f"__eg_{i}"
    imports.append(f"import * as {var} from './_test_{fn}';")
    entries.append(f'  "./{fn}": {var}')
replacement = "\n".join(imports) + "\nconst gameModules = {\n" + ",\n".join(entries) + "\n};"
marker = "const gameModules = import.meta.glob(['./*.js', '!./engine.js', '!./core.js'], { eager: true });"
assert_marker(engine_content, marker, "src/game/engine.js")
engine_content = engine_content.replace(marker, replacement)
with open("src/game/_test_engine_copy.js", "w", encoding="utf-8") as f:
    f.write(engine_content)

# --- ui/cardThemes.js : 3 import.meta.glob sur des assets .webp -> {} vide
# (thème "classique" par défaut, sans illustrations : suffisant pour un test
# de dispatch qui ne vérifie pas le rendu visuel des thèmes de cartes) ---
with open("src/ui/cardThemes.js", encoding="utf-8") as f:
    themes_content = f.read()
for marker in [
    "const autoBrandsFiles = import.meta.glob('../assets/cards/auto-brands/**/*.webp', { eager: true, import: 'default' });",
    "const mascotteFiles = import.meta.glob('../assets/cards/mascotte/**/*.webp', { eager: true, import: 'default' });",
    "const gameSlotFiles = import.meta.glob('../assets/cards/*/games/**/*.webp', { eager: true, import: 'default' });"
]:
    assert_marker(themes_content, marker, "src/ui/cardThemes.js")
themes_content = themes_content.replace(
    "const autoBrandsFiles = import.meta.glob('../assets/cards/auto-brands/**/*.webp', { eager: true, import: 'default' });",
    "const autoBrandsFiles = {};"
).replace(
    "const mascotteFiles = import.meta.glob('../assets/cards/mascotte/**/*.webp', { eager: true, import: 'default' });",
    "const mascotteFiles = {};"
).replace(
    "const gameSlotFiles = import.meta.glob('../assets/cards/*/games/**/*.webp', { eager: true, import: 'default' });",
    "const gameSlotFiles = {};"
)
with open("src/ui/_test_cardThemes_copy.js", "w", encoding="utf-8") as f:
    f.write(themes_content)

# --- ui/cards.js : copie repointant cardThemes.js vers la copie de test ---
with open("src/ui/cards.js", encoding="utf-8") as f:
    cards_content = f.read()
cards_content = cards_content.replace("from './cardThemes.js';", "from './_test_cardThemes_copy.js';")
with open("src/ui/_test_cards_copy.js", "w", encoding="utf-8") as f:
    f.write(cards_content)

# --- ui/settings.js : copie repointant cards.js vers la copie de test ---
with open("src/ui/settings.js", encoding="utf-8") as f:
    settings_content = f.read()
settings_content = settings_content.replace("from './cards.js';", "from './_test_cards_copy.js';")
with open("src/ui/_test_settings_copy.js", "w", encoding="utf-8") as f:
    f.write(settings_content)

# --- ui/gameShared.js : copie repointant engine.js vers la copie de test ---
with open("src/ui/gameShared.js", encoding="utf-8") as f:
    shared_content = f.read()
shared_content = shared_content.replace("from '../game/engine.js';", "from '../game/_test_engine_copy.js';")
with open("src/ui/_test_gameShared_copy.js", "w", encoding="utf-8") as f:
    f.write(shared_content)

# --- rules.js : import.meta.glob('../game/*.rules.js', { eager: true }) ---
with open("src/ui/rules.js", encoding="utf-8") as f:
    rules_content = f.read()
rules_files = sorted(f for f in os.listdir("src/game") if f.endswith(".rules.js") and not f.startswith("_test_"))
imports = []
entries = []
for i, fn in enumerate(rules_files):
    var = f"__rg_{i}"
    imports.append(f"import * as {var} from '../game/{fn}';")
    entries.append(f'  "../game/{fn}": {var}')
replacement = "\n".join(imports) + "\nconst ruleModules = {\n" + ",\n".join(entries) + "\n};"
marker = "const ruleModules = import.meta.glob('../game/*.rules.js', { eager: true });"
assert_marker(rules_content, marker, "src/ui/rules.js")
rules_content = rules_content.replace(marker, replacement)
with open("src/ui/_test_rules_copy.js", "w", encoding="utf-8") as f:
    f.write(rules_content)

# --- src/ui/games/*.js : verbatim copies, repointant tous les imports globés ---
ui_game_files = sorted(f for f in os.listdir("src/ui/games") if f.endswith(".js") and not f.startswith("_test_"))
for fn in ui_game_files:
    with open(f"src/ui/games/{fn}", encoding="utf-8") as f:
        content = f.read()
    content = content.replace("from '../../game/engine.js';", "from '../../game/_test_engine_copy.js';")
    content = content.replace("from '../rules.js';", "from '../_test_rules_copy.js';")
    content = content.replace("from '../gameShared.js';", "from '../_test_gameShared_copy.js';")
    content = content.replace("from '../cards.js';", "from '../_test_cards_copy.js';")
    content = content.replace("from '../cardThemes.js';", "from '../_test_cardThemes_copy.js';")
    content = content.replace("from '../settings.js';", "from '../_test_settings_copy.js';")
    for gfn in game_files:  # ex: from '../../game/pouilleux.js'; -> _test_pouilleux.js
        content = content.replace(f"from '../../game/{gfn}';", f"from '../../game/_test_{gfn}';")
    with open(f"src/ui/games/_test_{fn}", "w", encoding="utf-8") as f:
        f.write(content)

# --- game.js : import.meta.glob('./games/*.js', { eager: true }) + repointages ---
with open("src/ui/game.js", encoding="utf-8") as f:
    game_content = f.read()
game_content = game_content.replace("from '../game/engine.js';", "from '../game/_test_engine_copy.js';")
game_content = game_content.replace("from './rules.js';", "from './_test_rules_copy.js';")
game_content = game_content.replace("from './gameShared.js';", "from './_test_gameShared_copy.js';")
game_content = game_content.replace("from './cards.js';", "from './_test_cards_copy.js';")
for gfn in game_files:  # game.js importe aussi directement certains game/<id>.js (vue spectateur)
    game_content = game_content.replace(f"from '../game/{gfn}';", f"from '../game/_test_{gfn}';")

imports = []
entries = []
for i, fn in enumerate(ui_game_files):
    var = f"__ug_{i}"
    imports.append(f"import * as {var} from './games/_test_{fn}';")
    entries.append(f'  "./games/{fn}": {var}')
replacement = "\n".join(imports) + "\nconst gameUiModules = {\n" + ",\n".join(entries) + "\n};"
marker = "const gameUiModules = import.meta.glob('./games/*.js', { eager: true });"
assert_marker(game_content, marker, "src/ui/game.js")
game_content = game_content.replace(marker, replacement)
with open("src/ui/_test_game_copy.js", "w", encoding="utf-8") as f:
    f.write(game_content)

# --- main.js : strip import './style.css' + import.meta.glob('./game/*.bot.js') ---
with open("src/main.js", encoding="utf-8") as f:
    main_lines = f.readlines()
assert main_lines[0].strip() == "import './style.css';", "main.js : la 1ère ligne n'est plus l'import CSS attendu"
main_lines[0] = "// import stripped for raw-browser test\n"
main_content = "".join(main_lines)
main_content = main_content.replace("from './ui/lobby.js';", "from './ui/_test_lobby_copy.js';")
main_content = main_content.replace("from './ui/game.js';", "from './ui/_test_game_copy.js';")
main_content = main_content.replace("from './ui/settings.js';", "from './ui/_test_settings_copy.js';")
main_content = main_content.replace("from './game/engine.js';", "from './game/_test_engine_copy.js';")

bot_files = sorted(f for f in os.listdir("src/game") if f.endswith(".bot.js") and not f.startswith("_test_"))
imports = []
entries = []
for i, fn in enumerate(bot_files):
    var = f"__bg_{i}"
    imports.append(f"import * as {var} from './game/_test_{fn}';")
    entries.append(f'  "./game/{fn}": {var}')
replacement = "\n".join(imports) + "\nconst botModules = {\n" + ",\n".join(entries) + "\n};"
marker = "const botModules = import.meta.glob('./game/*.bot.js', { eager: true });"
assert_marker(main_content, marker, "src/main.js")
main_content = main_content.replace(marker, replacement)
with open("src/_test_main_copy.js", "w", encoding="utf-8") as f:
    f.write(main_content)

# --- lobby.js : verbatim copy, repointe engine.js ---
with open("src/ui/lobby.js", encoding="utf-8") as f:
    content = f.read()
content = content.replace("from '../game/engine.js';", "from '../game/_test_engine_copy.js';")
with open("src/ui/_test_lobby_copy.js", "w", encoding="utf-8") as f:
    f.write(content)

# --- fakes Supabase (backend en mémoire, jamais les vrais fichiers) ---
CLIENT_FAKE = """// Stub minimal : rien n'appelle directement `supabase.*` dans ce test, tout
// passe par `_test_sync_fake.js` — seul l'import doit résoudre sans erreur.
export const supabase = {};
"""

SYNC_FAKE = '''// Faux backend en mémoire pour tester main.js/engine.js/game.js hors Vite.
// Même surface que sync.js (createRoom/listRooms/deleteRoom/fetchRoomById/
// updateRoomState/subscribeRoom/ConflictError), plus des aides de test
// (__reset/__dump) utilisées uniquement depuis la page de test.

export class ConflictError extends Error {
  constructor() {
    super('La partie a ete mise a jour ailleurs, resynchronisation...');
    this.name = 'ConflictError';
  }
}

let rooms = new Map();
let nextId = 1;
const listeners = new Map();

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function randomCode(length = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function notify(roomId) {
  const row = rooms.get(roomId);
  if (!row) return;
  (listeners.get(roomId) || []).forEach((fn) => fn(clone(row)));
}

export async function createRoom(initialState, game = 'pouilleux') {
  const id = String(nextId++);
  const row = { id, code: randomCode(), game, state: initialState, version: 0, updated_at: new Date().toISOString() };
  rooms.set(id, row);
  return clone(row);
}

export async function fetchRoomById(id) {
  const row = rooms.get(id);
  return row ? clone(row) : null;
}

export async function listRooms(limit = 20) {
  return Array.from(rooms.values())
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, limit)
    .map(clone);
}

export async function updateRoomState(roomId, expectedVersion, newState, extraColumns = {}) {
  const row = rooms.get(roomId);
  if (!row || row.version !== expectedVersion) throw new ConflictError();
  const updated = { ...row, ...extraColumns, state: newState, version: expectedVersion + 1, updated_at: new Date().toISOString() };
  rooms.set(roomId, updated);
  notify(roomId);
  return clone(updated);
}

export async function deleteRoom(id) {
  rooms.delete(id);
  listeners.delete(id);
}

export function subscribeRoom(roomId, onChange) {
  let active = true;
  fetchRoomById(roomId).then((row) => { if (active && row) onChange(row); });
  if (!listeners.has(roomId)) listeners.set(roomId, new Set());
  const fn = (row) => { if (active) onChange(row); };
  listeners.get(roomId).add(fn);
  return () => { active = false; listeners.get(roomId)?.delete(fn); };
}

export function __reset() { rooms = new Map(); nextId = 1; listeners.clear(); }
export function __dump() { return Array.from(rooms.values()).map(clone); }
'''

with open("src/supabase/_test_client_fake.js", "w", encoding="utf-8") as f:
    f.write(CLIENT_FAKE)
with open("src/supabase/_test_sync_fake.js", "w", encoding="utf-8") as f:
    f.write(SYNC_FAKE)

# --- page de test ---
TEST_HTML = """<!doctype html>
<html lang="fr">
<head><meta charset="UTF-8" /><title>Test E2E — cartes-familiales</title></head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/_test_main_copy.js"></script>
  <script type="module">
    import * as sync from '/src/supabase/_test_sync_fake.js';
    window.__sync = sync;
  </script>
</body>
</html>
"""
with open("_test_e2e.html", "w", encoding="utf-8") as f:
    f.write(TEST_HTML)

print("Bundle de test généré :", len(game_files), "modules de jeu,", len(rules_files), "règles,",
      len(ui_game_files), "UI de jeu,", len(bot_files), "bots.")
print("Page de test : _test_e2e.html")
