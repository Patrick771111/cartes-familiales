-- Schéma de recette : jumeau isolé de `public`, DANS LE MÊME projet Supabase.
--
-- Pourquoi ici et pas dans un second projet Supabase : un projet gratuit inactif
-- est mis en pause au bout d'une semaine. Le projet de prod, lui, est maintenu
-- éveillé par l'usage réel de la famille. On garde donc un seul projet, et on
-- isole la recette par un schéma Postgres distinct.
--
-- Pourquoi un schéma et pas des tables préfixées (`game_rooms_recette`) : avec
-- un préfixe, l'isolation repose sur le nom de table écrit dans chaque requête,
-- et une seule qui l'oublie écrit en production. Avec un schéma, la portée est
-- fixée une fois à la création du client (`db: { schema }`) : même un
-- `.from('game_rooms')` écrit en dur par un agent atterrit au bon endroit.
--
-- À exécuter dans le SQL editor du projet Supabase. Idempotent : relançable.
-- Voir sql/schema.sql pour la version `public` (prod), qui reste la référence :
-- toute évolution de table doit être appliquée aux deux.

create schema if not exists recette;

create table if not exists recette.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  game text not null default 'pouilleux',
  state jsonb not null default '{}'::jsonb,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_rooms_created_at_idx on recette.game_rooms (created_at);

-- La fonction de trigger n'est pas dupliquée : elle est générique et vit déjà
-- dans `public`. Une seule définition, donc pas de dérive entre les deux schémas.
drop trigger if exists trg_game_rooms_updated_at on recette.game_rooms;
create trigger trg_game_rooms_updated_at
  before update on recette.game_rooms
  for each row execute function public.set_updated_at();

-- Realtime : indispensable pour que les téléphones se synchronisent. Pas de
-- `if not exists` sur une publication, d'où le bloc d'exception qui rend le
-- script relançable.
do $$
begin
  alter publication supabase_realtime add table recette.game_rooms;
exception
  when duplicate_object then null;
end $$;

-- Mêmes policies permissives que la prod : la recette doit se comporter comme
-- la prod, sinon elle ne prouve rien. (Modèle de confiance discuté dans
-- sql/schema.sql : accès protégé par le code de partie, pas par un compte.)
alter table recette.game_rooms enable row level security;

drop policy if exists "lecture publique" on recette.game_rooms;
create policy "lecture publique" on recette.game_rooms
  for select using (true);

drop policy if exists "ecriture publique" on recette.game_rooms;
create policy "ecriture publique" on recette.game_rooms
  for update using (true) with check (true);

drop policy if exists "creation publique" on recette.game_rooms;
create policy "creation publique" on recette.game_rooms
  for insert with check (true);

drop policy if exists "suppression publique" on recette.game_rooms;
create policy "suppression publique" on recette.game_rooms
  for delete using (true);

-- Sans ces droits, le schéma existe mais l'API répond en erreur : les grants de
-- `public` ne se propagent pas à un nouveau schéma.
grant usage on schema recette to anon, authenticated;
grant select, insert, update, delete on recette.game_rooms to anon, authenticated;

-- Dernière étape, NON scriptable : ajouter `recette` aux « Exposed schemas »
-- dans Project Settings → API. Sans ça PostgREST ignore le schéma et l'appli
-- reçoit une erreur au premier appel, sans rapport apparent avec la cause.
