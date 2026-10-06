-- White-label branding per organisation (firm name, primary colour, logo).
-- Additive only: creates one new table. No existing table, function or policy is changed.
-- Backend (service_role) reads and writes; anon/authenticated have no access.
begin;
create table if not exists public.office_org_branding (
  org_id uuid primary key,
  firm_name text not null check (length(btrim(firm_name)) between 1 and 120),
  primary_color text not null default '#0E5A52' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Small raster logo kept inline (PNG/JPEG/WebP only; SVG refused to avoid script injection).
  logo_data_url text check (
    logo_data_url is null or (
      logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
      and length(logo_data_url) <= 400000
    )
  ),
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.office_org_branding enable row level security;
revoke all on public.office_org_branding from public, anon, authenticated, service_role;
grant select, insert, update on public.office_org_branding to service_role;
commit;
