-- OFFICE MANAGER SUR LE SERVEUR DU CABINET (VPS), SANS SUPABASE — à exécuter UNE fois, AVANT db/INSTALL_TOUT.sql.
-- Recrée seulement ce que le SQL de l'application attendait de Supabase (2026-11-04) :
--   * les rôles anon / authenticated / service_role (cités par les GRANT / REVOKE de l'installation) ;
--   * auth.uid() : l'identifiant de la personne dont le serveur a VÉRIFIÉ la session (jamais une valeur du navigateur),
--     posé pour une seule transaction par lib/sql-rest.js (request.jwt.claim.sub).
-- L'application se connecte avec son propre compte PostgreSQL et prend le rôle service_role dans chaque transaction.
-- Sans danger si on le relance.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- The application's login role (the one in DATABASE_URL) may switch to service_role for each transaction.
grant service_role to current_user;

grant usage on schema public to anon, authenticated, service_role;
-- As in Supabase: what the application creates in public is usable by service_role.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create schema if not exists auth;
grant usage on schema auth to authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to authenticated, service_role;
