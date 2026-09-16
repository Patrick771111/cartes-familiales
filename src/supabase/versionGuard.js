// Garde-fou de version pour les écritures Supabase : un onglet resté ouvert depuis avant un
// déploiement tourne encore avec l'ancien code JS en mémoire (voir sw.js : les pages HTML sont
// network-first, mais une page déjà chargée ne se recharge pas toute seule). Avant chaque
// écriture, on revérifie que la version déployée n'a pas changé depuis le chargement de cet
// onglet — sinon on refuse d'écrire plutôt que de risquer un état corrompu par du code périmé.
// Source de vérité unique : CACHE_NAME dans sw.js (déjà incrémenté à chaque déploiement) — pas
// de numéro de version dupliqué à maintenir ailleurs. Désactivé en dev (pas de sw.js versionné,
// Vite recharge déjà le code en direct).
let versionChargee = null;

export function capturerVersionChargee() {
  if (!import.meta.env.PROD) return;
  versionDeployee().then((v) => {
    versionChargee = v;
  });
}

async function versionDeployee() {
  try {
    const txt = await fetch('/sw.js', { cache: 'no-store' }).then((r) => r.text());
    const m = txt.match(/CACHE_NAME\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * true si l'écriture peut se poursuivre : en dev, si la version n'a pas encore été capturée
 * (boot en cours), ou si la vérification échoue elle-même (réseau) -- best-effort, un échec du
 * contrôle ne doit pas rendre l'appli plus fragile qu'avant. Seul un vrai mismatch bloque.
 */
export async function versionAJour() {
  if (!import.meta.env.PROD || versionChargee === null) return true;
  const actuelle = await versionDeployee();
  return actuelle === null || actuelle === versionChargee;
}
