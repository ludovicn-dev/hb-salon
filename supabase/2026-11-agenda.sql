-- H&B Salon : agenda (rendez-vous). Pour une base créée avec l'ancien schema.sql.
-- À coller une fois dans Supabase → SQL Editor → New query → Run, avant la mise en ligne de la version avec l'agenda.
-- Seuls les rendez-vous des clients qui ont donné leur accord RGPD arrivent ici.

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

create index on public.appointments (owner, synced_at);
create index on public.appointments (client_id);

create trigger touch before insert or update on public.appointments for each row execute function public.touch_synced_at();

alter table public.appointments enable row level security;
create policy "own rows" on public.appointments for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

revoke all on public.appointments from anon;
grant select, insert, update, delete on public.appointments to authenticated;

alter table public.deletions
  drop constraint deletions_kind_check,
  add constraint deletions_kind_check check (kind in ('client', 'visit', 'photo', 'appointment'));
