-- À exécuter dans le SQL editor du projet Supabase de Repas malin
-- (nouvelle table dédiée, n'impacte pas les tables existantes).

create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  game text not null default 'pouilleux',
  state jsonb not null default '{}'::jsonb,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nettoyage auto : on ne garde pas des parties abandonnées indéfiniment.
create index if not exists game_rooms_created_at_idx on game_rooms (created_at);

-- updated_at automatique
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_game_rooms_updated_at on game_rooms;
create trigger trg_game_rooms_updated_at
  before update on game_rooms
  for each row execute function set_updated_at();

-- Realtime : indispensable pour que les téléphones se synchronisent.
alter publication supabase_realtime add table game_rooms;

-- RLS : app familiale sans authentification, accès protégé par le code de partie
-- (à connaître pour lire/écrire une ligne) + l'URL privée du tunnel, pas par un compte utilisateur.
-- C'est le même modèle de confiance que ton tunnel repas-ia : suffisant pour un usage familial,
-- mais à ne pas exposer publiquement sans réflexion supplémentaire (ex: RPC + rate limiting).
alter table game_rooms enable row level security;

drop policy if exists "lecture publique" on game_rooms;
create policy "lecture publique" on game_rooms
  for select using (true);

drop policy if exists "ecriture publique" on game_rooms;
create policy "ecriture publique" on game_rooms
  for update using (true) with check (true);

drop policy if exists "creation publique" on game_rooms;
create policy "creation publique" on game_rooms
  for insert with check (true);

-- Sans cette policy, `delete` est silencieusement bloqué par RLS (0 ligne
-- affectée, pas d'erreur renvoyée) : c'est ce qui empêchait la fermeture des
-- salons fantômes (voir `deleteRoom` dans supabase/sync.js) de fonctionner
-- en production alors que la logique applicative, elle, était correcte.
drop policy if exists "suppression publique" on game_rooms;
create policy "suppression publique" on game_rooms
  for delete using (true);
