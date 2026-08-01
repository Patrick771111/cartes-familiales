// Stratégie : le HTML (la page elle-même) va toujours vérifier le réseau en
// premier, pour être sûr de voir les mises à jour dès le prochain déploiement,
// avec repli sur le cache uniquement hors-ligne. Les fichiers JS/CSS générés
// par le build ont un nom unique (hash) à chaque déploiement, donc eux peuvent
// rester en cache sans risque de servir du contenu périmé.
const CACHE_NAME = 'cartes-familiales-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.includes('supabase.co')) return;
  if (url.origin !== self.location.origin) return;

  const isHtmlPage = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');

  if (isHtmlPage) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Ressources statiques (JS/CSS/images à noms hashés) : cache d'abord, elles
  // ne changent jamais de contenu sous un même nom de fichier.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.status === 200) cache.put(request, response.clone());
      return response;
    })
  );
});
