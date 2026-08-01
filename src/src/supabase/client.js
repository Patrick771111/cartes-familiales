import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Erreur volontairement bruyante : évite de chercher pendant 20 min pourquoi rien ne se passe.
  console.error(
    '[cartes-familiales] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants. ' +
    'Copie .env.example vers .env et renseigne les valeurs du projet Supabase de Repas malin.'
  );
}

export const supabase = createClient(url, anonKey, {
  realtime: { params: { eventsPerSecond: 10 } }
});
