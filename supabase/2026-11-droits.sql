-- H&B Salon : droits au plus juste et statut des visites contrôlé. Pour une base créée avant ce fichier.
-- À coller une fois dans Supabase → SQL Editor → New query → Run (peut être relancé sans dommage).
-- Rien ne change pour l'appli : elle ne fait que lire, ajouter, modifier et effacer, et n'écrit que 'pending' ou 'done'.

-- Supabase donne d'office tous les droits à authenticated (TRUNCATE compris, qui passe outre la RLS).
revoke all on public.clients, public.visits, public.photos, public.appointments, public.deletions from anon, authenticated;
grant select, insert, update, delete on public.clients, public.visits, public.photos, public.appointments, public.deletions to authenticated;

-- Échoue si une visite a un autre statut (ne devrait pas exister) : rien n'est alors modifié.
alter table public.visits
  drop constraint if exists visits_status_check,
  add constraint visits_status_check check (status in ('pending', 'done'));

-- Vérification : doit ne rien renvoyer.
select table_name, privilege_type from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema = 'public'
  and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
