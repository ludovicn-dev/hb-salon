-- H&B Salon : tables de la sauvegarde en ligne.
-- À coller une seule fois dans Supabase → SQL Editor → New query → Run.
-- Chaque ligne appartient au compte connecté (owner) ; personne d'autre ne peut la lire ni l'écrire.
-- synced_at est posé par le serveur : la tablette s'en sert pour ne récupérer que les nouveautés.

create table public.clients (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  email text not null default '',
  allergies text not null default '',
  consent_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);

create table public.visits (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid not null references public.clients on delete cascade,
  date timestamptz not null,
  services text[] not null default '{}',
  formula jsonb not null default '{}',
  note text not null default '',
  status text not null default 'pending',
  validated_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- Les fichiers sont dans le stockage « photos » : <owner>/<id>.jpg et <owner>/<id>-thumb.jpg.
create table public.photos (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  visit_id uuid not null references public.visits on delete cascade,
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- Rendez-vous de l'agenda (seulement ceux des clients avec accord RGPD).
create table public.appointments (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid not null references public.clients on delete cascade,
  first_name text not null default '',
  phone text not null default '',
  start_at timestamptz not null,
  duration_min int not null check (duration_min > 0),
  services text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- Effacements (fiche sans accord RGPD, visite, photo ou rendez-vous supprimés) : seulement l'identifiant,
-- pour que les autres tablettes effacent aussi leur copie.
create table public.deletions (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('client', 'visit', 'photo', 'appointment')),
  deleted_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create index on public.clients (owner, synced_at);
create index on public.visits (owner, synced_at);
create index on public.visits (client_id);
create index on public.photos (owner, synced_at);
create index on public.photos (visit_id);
create index on public.appointments (owner, synced_at);
create index on public.appointments (client_id);
create index on public.deletions (owner, synced_at);

create function public.touch_synced_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

create trigger touch before insert or update on public.clients for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.visits for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.photos for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.appointments for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.deletions for each row execute function public.touch_synced_at();

alter table public.clients enable row level security;
alter table public.visits enable row level security;
alter table public.photos enable row level security;
alter table public.appointments enable row level security;
alter table public.deletions enable row level security;

create policy "own rows" on public.clients for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "own rows" on public.visits for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "own rows" on public.photos for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "own rows" on public.appointments for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "own rows" on public.deletions for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

revoke all on public.clients, public.visits, public.photos, public.appointments, public.deletions from anon;
grant select, insert, update, delete on public.clients, public.visits, public.photos, public.appointments, public.deletions to authenticated;

-- Photos : stockage privé, chaque compte dans son dossier.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "own photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
