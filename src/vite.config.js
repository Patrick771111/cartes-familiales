import { defineConfig } from 'vite';

export default defineConfig({
  // Utile si un jour tu déploies sous un sous-chemin (ex: /cartes/) derrière ton tunnel Cloudflare.
  // Laisse '/' pour un déploiement à la racine (Netlify, etc.)
  base: '/',
  server: {
    host: true, // accessible depuis le réseau local (utile pour tester sur les smartphones sans déployer)
    port: 5173
  }
});
