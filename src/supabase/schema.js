/**
 * Schéma Supabase visé.
 *
 * `VITE_SUPABASE_SCHEMA` permet de basculer le schéma vers `recette`
 * (ou n'importe quel autre schéma local au même projet) sans toucher au code.
 * À défaut, le schéma par défaut `public` — identique au comportement
 * production.
 */
export const schema = import.meta.env.VITE_SUPABASE_SCHEMA || 'public';
