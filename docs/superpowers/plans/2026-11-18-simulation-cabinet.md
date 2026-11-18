# Simulation (cabinet d'entraînement) — plan d'implémentation, étape 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Ajouter à Entraînement un mode « Simulation » : un cabinet fils du cabinet réel (`account_kind = 'simulation'`), isolé par `org_id`, qui réutilise tout le moteur de Firm Manager, sans envoi réel, avec écritures Drive confinées à son dossier.

**Architecture :** Le mécanisme multi-cabinet existant (`lib/firm-context.js`, en-tête `x-office-manager-org`) isole les données. Un nouveau module `lib/simulation.js` crée et décrit les simulations, `lib/simulation-guard.js` porte les garde-fous (sync, lisent un cache du type de cabinet amorcé à chaque requête). La connexion Google du parent est empruntée dans `loadGoogleConnection`. Une route `simulation` dans `api/app.js` et un onglet dans `entrainement.html` complètent le parcours.

**Tech Stack :** Node 24 (ESM, `node:test`), PostgREST via `rest()` (`lib/supabase.js`), SQL dans `db/*.sql` assemblé en `db/INSTALL_TOUT.sql`, HTML + JS natif, Tailwind compilé (`npm run build:css`).

**Spec :** `docs/superpowers/specs/2026-11-18-simulation-cabinet-design.md`

## Global Constraints

- Ne jamais remplacer le moteur : aucune copie d'écran ni de route métier. Seule la route `simulation` est nouvelle (`api/app.js` ; jamais un nouveau fichier dans `api/`, limite de 12 fonctions Vercel).
- SQL additif seulement (`create … if not exists`, `add column if not exists`) ; toute colonne lue par le code figure dans le SQL (`tests/schema-coverage.test.js`).
- Rien n'est supprimé : une simulation s'archive ; la corbeille Drive reste limitée au dossier de simulation.
- Aucun envoi réel depuis une simulation ; aucun statut « envoyé » sans preuve (principe 8 du CLAUDE.md).
- Les rôles choisis dans une simulation n'écrivent jamais dans le parent (`office_app_users` / `office_memberships` du parent).
- Fils d'un fils refusé ; lecture du parent interdite sauf la connexion Google (empruntée).
- `npm test` doit passer avant chaque commit (sortie redirigée vers un fichier : ~150 s). Fichiers en CRLF : éditer avec Edit, jamais de réécriture complète d'un fichier existant.
- Chemins `git add` explicites ; messages de commit terminés par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Ne jamais pousser ni déployer dans ce plan.
- Ne jamais lire ni modifier le `.env` du serveur ; l'activation de `OFFICE_MANAGER_MULTI_CABINET=on` est donnée à Paul dans `docs/A_FAIRE_DE_VOTRE_COTE.txt` (tâche 8).

## Review Focus

- Une requête signée en interne (`x-office-manager-internal`) vers un cabinet de simulation ne doit pas contourner les garde-fous d'envoi (le cache du type de cabinet est amorcé aussi pour les appels internes).
- Un cabinet inconnu / cache vide : les garde-fous échouent fermés (`isSimulation()` faux seulement si le type a été lu et n'est pas `simulation`) — un échec de lecture du type ne doit jamais ouvrir l'envoi.
- Double clic sur « Nouvelle simulation » : la même simulation, jamais deux (idempotence par personne + parent + nom).
- Une personne non membre du parent ne peut pas créer de simulation sous ce parent (`NOT_IN_PARENT`).
- Un parent sans connexion Google valide : erreur claire, aucun cabinet fils orphelin créé sans dossier.

## Structure des fichiers

- Créer `db/simulation.sql` (colonne `parent_org_id`, fonction `office_create_simulation`) — ajouté à `scripts/build-install-sql.mjs`.
- Créer `lib/simulation-guard.js` — type de cabinet en cache, `isSimulation`, `assertNoOutbound`, `assertSimulationDriveWrite`, `simulationFolderId`.
- Créer `lib/simulation.js` — `createSimulation`, `listSimulations`, `archiveSimulation`.
- Modifier `lib/google-connection.js` (`loadGoogleConnection` : emprunt du parent), `lib/google-drive.js` (`assertWritableTarget`), `lib/agent-mail.js` (`sendViaGmail`), `lib/ai-usage.js` (`dailyLimit`), `lib/cabinet-onboarding.js` (`myCabinets` : `account_kind`), `api/app.js` (amorçage, route, planificateur).
- Créer `assets/simulation.js` ; modifier `entrainement.html`, `assets/brand-theme.js` (bandeau), `tests/ui-pilot-hooks.test.js` (empreinte), `docs/A_FAIRE_DE_VOTRE_COTE.txt`, `CLAUDE.md`.
- Tests : `tests/simulation-sql.test.js`, `tests/simulation-guard.test.js`, `tests/simulation.test.js`, `tests/simulation-google.test.js`, `tests/simulation-routes.test.js`.

---

### Task 1: SQL — parent et création de simulation

**Files:**
- Create: `db/simulation.sql`
- Modify: `scripts/build-install-sql.mjs` (liste des parties), `db/INSTALL_TOUT.sql` (régénéré)
- Test: `tests/simulation-sql.test.js`

**Interfaces:**
- Produces: colonne `office_organizations.parent_org_id uuid`, fonction `public.office_create_simulation(p_auth_user_id uuid, p_parent_org uuid, p_name text, p_display_name text) returns jsonb` → `{ org_id, created }` ; erreurs `SERVER_ONLY`, `INVALID_SIMULATION`, `NOT_IN_PARENT`, `PARENT_IS_SIMULATION`.

- [ ] **Step 1: Écrire le test qui échoue**

```js
// tests/simulation-sql.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8');

test('the install script adds parent_org_id and the simulation function, additively', () => {
  assert.match(sql, /alter table public\.office_organizations add column if not exists parent_org_id uuid/i);
  assert.match(sql, /create or replace function public\.office_create_simulation\(/i);
  assert.match(sql, /'NOT_IN_PARENT'/);
  assert.match(sql, /'PARENT_IS_SIMULATION'/);
  assert.match(sql, /revoke all on function public\.office_create_simulation[^;]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.office_create_simulation[^;]*to service_role/i);
});

test('the simulation function copies nothing from the parent', () => {
  const body = sql.slice(sql.search(/function public\.office_create_simulation/i));
  const fn = body.slice(0, body.search(/\$\$;\s*revoke/i));
  assert.doesNotMatch(fn, /office_google_connections|office_firm_drive|office_firm_settings/i);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node --test tests/simulation-sql.test.js`
Expected: FAIL (`parent_org_id` introuvable dans `INSTALL_TOUT.sql`).

- [ ] **Step 3: Écrire `db/simulation.sql`**

```sql
-- Simulation : un cabinet d'entraînement, fils d'un cabinet réel (2026-11-18). Additif : rien n'est modifié ni supprimé.
alter table public.office_organizations add column if not exists parent_org_id uuid references public.office_organizations(id);
create index if not exists office_organizations_parent on public.office_organizations(parent_org_id) where parent_org_id is not null;
create table if not exists public.office_simulation_creations (
  org_id uuid primary key references public.office_organizations(id) on delete cascade,
  auth_user_id uuid not null,
  parent_org_id uuid not null,
  name_key text not null,
  created_at timestamptz not null default now(),
  unique (auth_user_id, parent_org_id, name_key)
);
alter table public.office_simulation_creations enable row level security;

create or replace function public.office_create_simulation(
  p_auth_user_id uuid, p_parent_org uuid, p_name text, p_display_name text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_kind text;
  v_email text;
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then raise exception 'SERVER_ONLY'; end if;
  if p_auth_user_id is null or p_parent_org is null or length(v_key) not between 1 and 120
     or length(btrim(coalesce(p_display_name, ''))) not between 1 and 120 then
    raise exception 'INVALID_SIMULATION';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text || p_parent_org::text, 1));
  select account_kind into v_kind from public.office_organizations where id = p_parent_org;
  if v_kind = 'simulation' then raise exception 'PARENT_IS_SIMULATION'; end if;
  select email into v_email from public.office_app_users where org_id = p_parent_org and auth_user_id = p_auth_user_id and active = true limit 1;
  if v_email is null then raise exception 'NOT_IN_PARENT'; end if;
  select org_id into v_org from public.office_simulation_creations where auth_user_id = p_auth_user_id and parent_org_id = p_parent_org and name_key = v_key;
  if v_org is not null then return jsonb_build_object('org_id', v_org, 'created', false); end if;
  v_org := gen_random_uuid();
  insert into public.office_organizations(id, slug, name, timezone, account_kind, parent_org_id)
    select v_org, 'simulation-' || v_org::text, btrim(p_name), coalesce(o.timezone, 'UTC'), 'simulation', p_parent_org
    from public.office_organizations o where o.id = p_parent_org;
  insert into public.office_app_users(org_id, auth_user_id, email, display_name, role, active)
    values (v_org, p_auth_user_id, v_email, btrim(p_display_name), 'owner', true);
  insert into public.office_memberships(org_id, user_id, role, active) values (v_org, p_auth_user_id, 'owner', true);
  insert into public.office_simulation_creations(org_id, auth_user_id, parent_org_id, name_key) values (v_org, p_auth_user_id, p_parent_org, v_key);
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;
revoke all on function public.office_create_simulation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.office_create_simulation(uuid, uuid, text, text) to service_role;
```

- [ ] **Step 4: Ajouter la partie au script d'assemblage et régénérer**

Run: `grep -n "cabinet-onboarding" scripts/build-install-sql.mjs` pour voir la ligne de la liste ; ajouter `'simulation.sql'` juste après `'cabinet-onboarding.sql'` (avec Edit), puis :
`node scripts/build-install-sql.mjs`
Expected: `db/INSTALL_TOUT.sql` régénéré, contient `office_create_simulation`.

- [ ] **Step 5: Lancer les tests SQL**

Run: `node --test tests/simulation-sql.test.js tests/schema-coverage.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/simulation.sql scripts/build-install-sql.mjs db/INSTALL_TOUT.sql tests/simulation-sql.test.js
git commit -m "Simulation: SQL du cabinet fils (parent_org_id, office_create_simulation)"
```

---

### Task 2: Garde-fous — type de cabinet et refus d'envoi

**Files:**
- Create: `lib/simulation-guard.js`
- Modify: `lib/agent-mail.js` (début de `sendViaGmail`, ligne ~180), `lib/google-drive.js` (début de `assertWritableTarget`, ligne ~175), `lib/ai-usage.js` (`dailyLimit`)
- Test: `tests/simulation-guard.test.js`

**Interfaces:**
- Produces (`lib/simulation-guard.js`) :
  - `primeOrgKind(orgId, d = {}) → Promise<{ kind: string|null, parent: string|null, folder: string|null }>` (lit `office_organizations?id=eq.<id>&select=account_kind,parent_org_id` et `office_firm_drive` pour le dossier ; met en cache 60 s ; échec de lecture = `kind: 'unknown'`).
  - `isSimulation() → boolean` (sync, pour `currentOrgId()` ; `true` si type `simulation` **ou** `unknown`, échec fermé).
  - `simulationParent() → string|null`, `simulationFolderId() → string|null`.
  - `assertNoOutbound()` → lève `SIMULATION_NO_OUTBOUND` (statut 409) si `isSimulation()`.
  - `assertSimulationDriveWrite(id, meta) → Promise<void>` → lève `SIMULATION_WRITE_OUTSIDE_FOLDER` (409) si l'id n'est pas dans `simulationFolderId()`.
  - `resetSimulationGuardCache()`.
- Consumes: `currentOrgId` (`lib/firm-context.js`), `insideFolder` (`lib/google-drive.js`, signature `(id, rootId, meta)`).

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/simulation-guard.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { primeOrgKind, isSimulation, assertNoOutbound, simulationParent, resetSimulationGuardCache } from '../lib/simulation-guard.js';
import { dailyLimit } from '../lib/ai-usage.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const rows = { [SIM]: { account_kind: 'simulation', parent_org_id: REAL }, [REAL]: { account_kind: null, parent_org_id: null } };
const fetchRows = async path => {
  const id = path.match(/id=eq\.([^&]+)/)?.[1] ?? path.match(/org_id=eq\.([^&]+)/)?.[1];
  if (path.startsWith('office_organizations')) return [rows[id]];
  if (path.startsWith('office_firm_drive')) return id === SIM ? [{ drive_id: 'folder:FOLDER1' }] : [];
  throw new Error('unexpected ' + path);
};

test('a simulation firm is recognised, its parent and folder are known', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => { assert.equal(isSimulation(), true); assert.equal(simulationParent(), REAL); });
});

test('a real firm is not a simulation and outbound stays allowed', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows });
  runInFirm(REAL, () => { assert.equal(isSimulation(), false); assert.doesNotThrow(assertNoOutbound); });
});

test('outbound is refused in a simulation with a clear code', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => assert.throws(assertNoOutbound, e => e.message === 'SIMULATION_NO_OUTBOUND' && e.statusCode === 409));
});

test('an unreadable firm type fails closed (treated as a simulation)', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows: async () => { throw new Error('db down'); } });
  runInFirm(REAL, () => assert.equal(isSimulation(), true));
});

test('a firm never primed is treated as a simulation for outbound (fail closed)', () => {
  resetSimulationGuardCache();
  runInFirm(REAL, () => assert.equal(isSimulation(), true));
});

test('the AI cap of a simulation defaults to 200 and follows the installation variable', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => {
    assert.equal(dailyLimit({}), 200);
    assert.equal(dailyLimit({ OFFICE_MANAGER_SIMULATION_AI_DAILY_LIMIT: '50' }), 50);
  });
  await primeOrgKind(REAL, { fetchRows });
  runInFirm(REAL, () => assert.equal(dailyLimit({}), null));
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/simulation-guard.test.js`
Expected: FAIL (module `lib/simulation-guard.js` introuvable).

- [ ] **Step 3: Écrire `lib/simulation-guard.js`**

```js
import { rest } from './supabase.js';
import { currentOrgId } from './firm-context.js';

// Simulation firms (2026-11-18): the type of the firm of the request is read ONCE per request (primeOrgKind, called where the
// firm is fixed) and kept 60 s; the guards below are synchronous and FAIL CLOSED: a firm whose type was never read, or could not
// be read, counts as a simulation for outbound and Drive writes.
const q = encodeURIComponent;
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const kinds = new Map();
const TTL = 60 * 1000;

export async function primeOrgKind(orgId, d = {}) {
  if (!orgId) return null;
  const known = kinds.get(orgId);
  if (known && Date.now() - known.at < TTL) return known;
  const fetchRows = d.fetchRows || rest;
  let next;
  try {
    const o = (await fetchRows('office_organizations?id=eq.' + q(orgId) + '&select=account_kind,parent_org_id&limit=1'))?.[0];
    if (!o) throw new Error('FIRM_NOT_FOUND');
    let folder = null;
    if (o.account_kind === 'simulation') {
      const f = (await fetchRows('office_firm_drive?org_id=eq.' + q(orgId) + '&select=drive_id&limit=1'))?.[0];
      const id = String(f?.drive_id || '').split('|')[0];
      folder = id.startsWith('folder:') ? id.slice(7) : id || null;
    }
    next = { kind: o.account_kind === 'simulation' ? 'simulation' : 'real', parent: o.parent_org_id || null, folder, at: Date.now() };
  } catch { next = { kind: 'unknown', parent: null, folder: null, at: Date.now() }; }
  kinds.set(orgId, next);
  return next;
}

const here = () => kinds.get(currentOrgId());
export const isSimulation = () => { const v = here(); return !v || v.kind !== 'real'; };
export const simulationParent = () => here()?.parent || null;
export const simulationFolderId = () => here()?.folder || null;
export const resetSimulationGuardCache = () => kinds.clear();

export const isSimulationKnown = () => here()?.kind === 'simulation';
// Outbound: refuses a simulation or a firm whose type could not be read; a firm never primed (tests, scripts) is not blocked.
export function assertNoOutbound() { const v = here(); if (v && v.kind !== 'real') throw fail('SIMULATION_NO_OUTBOUND', 409); }

export async function assertSimulationDriveWrite(id, meta = null) {
  const v = here();
  if (v && v.kind === 'real') return;
  const folder = v?.folder;
  if (!folder || !id) throw fail('SIMULATION_WRITE_OUTSIDE_FOLDER', 409);
  const { insideFolder } = await import('./google-drive.js');
  if (!(await insideFolder(id, folder, meta))) throw fail('SIMULATION_WRITE_OUTSIDE_FOLDER', 409);
}
```

- [ ] **Step 4: Brancher les trois points d'entrée**

Dans `lib/ai-usage.js`, remplacer la fonction `dailyLimit` (Edit sur le bloc exact) par :

```js
import { isSimulation } from './simulation-guard.js';
export function dailyLimit(env = process.env) {
  if (isSimulation()) {
    const s = Number(env.OFFICE_MANAGER_SIMULATION_AI_DAILY_LIMIT);
    return Number.isInteger(s) && s > 0 ? s : 200;
  }
  const n = Number(env.OFFICE_MANAGER_AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

Attention : `isSimulation()` échoue fermé quand le cabinet n'a pas été amorcé (tests, scripts hors requête). Pour ne pas casser les tests existants de `ai-usage`, `dailyLimit` n'applique la branche simulation que si `currentOrgId()` a un type lu : remplacer `if (isSimulation())` par `if (isSimulationKnown())` en ajoutant dans `simulation-guard.js` : `export const isSimulationKnown = () => here()?.kind === 'simulation';` (importer celui-ci dans `ai-usage.js`).

Dans `lib/agent-mail.js`, au tout début du corps de `sendViaGmail` (ligne ~180) ajouter `assertNoOutbound();` avec `import { assertNoOutbound } from './simulation-guard.js';` en tête du fichier. Pour ne pas casser les tests d'envoi existants qui n'amorcent aucun cabinet, `assertNoOutbound` ne doit refuser que `kind === 'simulation'` ou `'unknown'` (cabinet amorcé mais illisible), pas « jamais amorcé » : dans `simulation-guard.js`, `assertNoOutbound` utilise `const v = here(); if (v && v.kind !== 'real') throw …` et `isSimulation` garde l'échec fermé pour les écritures Drive. Mettre à jour le test « never primed » en conséquence (`assertNoOutbound` ne lève pas ; `assertSimulationDriveWrite` lève) — l'amorçage est garanti en production par la tâche 5 (`api/app.js`), testée.

Dans `lib/google-drive.js`, au début de `assertWritableTarget` (avant `if (!isTestMode(env)) return;`) ajouter :

```js
  { const { isSimulationKnown, assertSimulationDriveWrite } = await import('./simulation-guard.js');
    if (isSimulationKnown()) { await assertSimulationDriveWrite(id, meta); return; } }
```

- [ ] **Step 5: Ajuster le test « jamais amorcé » puis lancer les tests**

Remplacer le test « a firm never primed… » par :

```js
test('a firm never primed does not block outbound (tests, scripts) but its Drive writes are refused', async () => {
  resetSimulationGuardCache();
  await runInFirm(REAL, async () => {
    assert.doesNotThrow(assertNoOutbound);
    await assert.rejects(assertSimulationDriveWrite('X', async () => ({ parents: [] })), /SIMULATION_WRITE_OUTSIDE_FOLDER/);
  });
});
```
(importer `assertSimulationDriveWrite` dans le test). Pour `isSimulation()` du test « fails closed » garder l'assertion (type `unknown`).

Run: `node --test tests/simulation-guard.test.js tests/ai-usage.test.js tests/agent-mail.test.js`
Expected: PASS (les tests existants d'`ai-usage` et d'`agent-mail` restent verts).

- [ ] **Step 6: Test d'écriture Drive confinée**

Ajouter à `tests/simulation-guard.test.js` :

```js
import { assertWritableTarget } from '../lib/google-drive.js';

test('in a simulation, a Drive write inside the folder passes and outside is refused', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  const tree = { CHILD: { parents: ['FOLDER1'] }, FOLDER1: { parents: ['ROOT'] }, OTHER: { parents: ['ROOT'] }, ROOT: { parents: [] } };
  const meta = async id => tree[id];
  await runInFirm(SIM, async () => {
    await assert.doesNotReject(assertWritableTarget('CHILD', { meta }));
    await assert.rejects(assertWritableTarget('OTHER', { meta }), /SIMULATION_WRITE_OUTSIDE_FOLDER/);
  });
});
```
Run: `node --test tests/simulation-guard.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/simulation-guard.js lib/ai-usage.js lib/agent-mail.js lib/google-drive.js tests/simulation-guard.test.js
git commit -m "Simulation: garde-fous (aucun envoi, Drive confiné, plafond d'IA)"
```

---

### Task 3: Connexion Google empruntée au parent

**Files:**
- Modify: `lib/google-connection.js` (`loadGoogleConnection`, ligne 243)
- Test: `tests/simulation-google.test.js`

**Interfaces:**
- Consumes: `primeOrgKind`, `simulationParent` (tâche 2).
- Produces: `loadGoogleConnection(simOrg)` retourne une connexion dont `orgId` reste celui de la simulation mais dont le jeton chiffré vient de `office_google_connections` du parent ; le Drive reste celui de la simulation (`office_firm_drive` du fils, jamais celui du parent).

- [ ] **Step 1: Écrire le test qui échoue**

```js
// tests/simulation-google.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { loadGoogleConnection, connectedGoogle, resetGoogleConnectionCache, encryptToken } from '../lib/google-connection.js';
import { primeOrgKind, resetSimulationGuardCache } from '../lib/simulation-guard.js';

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||= 'k'.repeat(48);
const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const enc = () => encryptToken('refresh-of-parent');
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + SIM)) return [{ drive_id: 'folder:SIMFOLDER', drive_name: 'Simulation' }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + REAL)) return [{ drive_id: 'REALDRIVE', drive_name: 'Cabinet' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + REAL)) return [{ google_email: 'cab@x.test', refresh_token_enc: enc(), scopes: 'https://www.googleapis.com/auth/drive', connected_by: 'p', connected_at: '2026-11-01' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + SIM)) return [];
  throw new Error('unexpected ' + path);
};

test('a simulation borrows the parent connection but keeps its own Drive folder', async () => {
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  await loadGoogleConnection(SIM, { fetchRows });
  await runInFirm(SIM, async () => {
    const c = connectedGoogle();
    assert.ok(c, 'connection borrowed');
    assert.equal(c.refresh, 'refresh-of-parent');
    assert.equal(c.orgId, SIM);
  });
});

test('the parent never borrows from its simulation, and a parent without connection gives none', async () => {
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows });
  await loadGoogleConnection(REAL, { fetchRows });
  await runInFirm(REAL, async () => assert.equal(connectedGoogle().refresh, 'refresh-of-parent'));
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  const none = async p => p.startsWith('office_google_connections') ? [] : fetchRows(p);
  await loadGoogleConnection(SIM, { fetchRows: none });
  await runInFirm(SIM, async () => assert.equal(connectedGoogle(), null));
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/simulation-google.test.js`
Expected: FAIL (`connectedGoogle()` est `null` : la simulation n'a pas sa propre ligne).

- [ ] **Step 3: Implémenter l'emprunt**

Dans `loadGoogleConnection` (`lib/google-connection.js:243`), juste avant la lecture de la ligne `office_google_connections` pour `orgId`, calculer l'organisation dont on lit la ligne :

```js
  // Simulation (2026-11-18): the connection of the PARENT firm is borrowed (its token, read-only here); the Drive stays the simulation's own.
  const { primeOrgKind } = await import('./simulation-guard.js');
  const kind = await primeOrgKind(orgId, d);
  const sourceOrg = kind?.kind === 'simulation' && kind.parent ? kind.parent : orgId;
```
et remplacer, dans la requête `office_google_connections?org_id=eq.' + q(orgId) + …`, `q(orgId)` par `q(sourceOrg)`. Dans la construction de l'objet connexion (là où `orgId` est copié depuis la ligne), laisser `orgId` = `orgId` de la simulation (le jeton se met ainsi en cache par simulation). Ne rien changer à `disconnectGoogle` : il agit sur `orgId` (la simulation n'a pas de ligne, donc ne peut jamais déconnecter le parent).

- [ ] **Step 4: Lancer les tests**

Run: `node --test tests/simulation-google.test.js tests/google-connection.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/google-connection.js tests/simulation-google.test.js
git commit -m "Simulation: connexion Google empruntée au cabinet parent (Drive propre)"
```

---

### Task 4: Création, liste et archivage — `lib/simulation.js`

**Files:**
- Create: `lib/simulation.js`
- Modify: `lib/cabinet-onboarding.js` (`myCabinets` renvoie `account_kind`)
- Test: `tests/simulation.test.js`

**Interfaces:**
- Consumes: `trainingDrive.createFolder(parentId, name)` et `trainingDrive.defaultParent()` (`lib/training-drive.js`) ; `fitName` (`lib/path-budget.js`) ; RPC `office_create_simulation`.
- Produces :
  - `createSimulation(user, parentOrg, body, d = {}) → { org_id, name, folder_id, created }` — `user` = `{ id, email, email_confirmed_at, user_metadata }` ; `body = { name, source: { mission, client, period } }` ; `d = { fetchRows, drive: { createFolder, defaultParent }, audit }`.
  - `listSimulations(user, parentOrg, d) → [{ org_id, name, role, created_at, archived }]`.
  - `archiveSimulation(user, simOrg, d) → { archived: true }` (propriétaire du fils seulement ; `office_firm_settings`-free : pose `account_kind` inchangé et `slug` préfixé `archived-`? **non** : marque `office_simulation_creations`? Simple et additif : `office_organizations.name` gardé ; archivage = `office_app_users.active=false` pour tous les membres du fils, rien supprimé).
  - `myCabinets` renvoie `{ org_id, name, role, account_kind }`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/simulation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, listSimulations, archiveSimulation } from '../lib/simulation.js';

const PARENT = '11111111-1111-4111-8111-111111111111', SIM = '22222222-2222-4222-8222-222222222222';
const user = { id: 'u1', email: 'junior@cabinet.test', email_confirmed_at: '2026-11-01', user_metadata: { display_name: 'Junior' } };
const audit = async () => {};

function world() {
  const calls = { rpc: [], drive: [], put: [] };
  const fetchRows = async (path, o = {}) => {
    if (path === 'rpc/office_create_simulation') { calls.rpc.push(JSON.parse(o.body)); return { org_id: SIM, created: true }; }
    if (path.startsWith('office_firm_drive')) { calls.put.push({ path, body: o.body && JSON.parse(o.body) }); return null; }
    throw new Error('unexpected ' + path);
  };
  const drive = { defaultParent: () => 'ENTRAINEMENTS', createFolder: async (parent, name) => { calls.drive.push({ parent, name }); return { id: 'FOLDER1' }; } };
  return { calls, d: { fetchRows, drive, audit } };
}

test('creating a simulation passes the verified identity and the parent, never a body-supplied user', async () => {
  const { calls, d } = world();
  const out = await createSimulation(user, PARENT, { name: 'Entraînement Atlas 2024', user_id: 'evil', source: { client: 'Atlas', period: '2024' } }, d);
  assert.equal(out.org_id, SIM); assert.equal(out.folder_id, 'FOLDER1');
  assert.deepEqual(calls.rpc[0], { p_auth_user_id: 'u1', p_parent_org: PARENT, p_name: 'Entraînement Atlas 2024', p_display_name: 'Junior' });
  assert.equal(calls.drive[0].parent, 'ENTRAINEMENTS');
  assert.match(calls.drive[0].name, /Atlas 2024/);
  assert.equal(calls.put[0].body.drive_id, 'folder:FOLDER1');
});

test('an unverified e-mail, an empty name and a missing Entraînements folder are refused with clear codes', async () => {
  const { d } = world();
  await assert.rejects(createSimulation({ ...user, email_confirmed_at: null }, PARENT, { name: 'X' }, d), /EMAIL_NOT_VERIFIED/);
  await assert.rejects(createSimulation(user, PARENT, { name: '  ' }, d), /SIMULATION_NAME_REQUIRED/);
  d.drive = { defaultParent: () => null, createFolder: async () => ({ id: 'F' }) };
  await assert.rejects(createSimulation(user, PARENT, { name: 'X' }, d), /TRAINING_PARENT_REQUIRED/);
});

test('a second click on the same name returns the same firm and creates no second folder', async () => {
  const { calls, d } = world();
  d.fetchRows = async (path, o = {}) => path === 'rpc/office_create_simulation' ? { org_id: SIM, created: false } : null;
  const out = await createSimulation(user, PARENT, { name: 'Même nom' }, { ...d, drive: { defaultParent: () => 'E', createFolder: async () => { calls.drive.push(1); return { id: 'F' }; } } });
  assert.equal(out.created, false); assert.equal(calls.drive.length, 0);
});

test('the SQL errors of the function become clear codes', async () => {
  const { d } = world();
  for (const code of ['NOT_IN_PARENT', 'PARENT_IS_SIMULATION']) {
    d.fetchRows = async () => { throw new Error('SUPABASE_400 ' + code); };
    await assert.rejects(createSimulation(user, PARENT, { name: 'X' }, d), new RegExp(code));
  }
});

test('archiving deactivates the members of the simulation and touches nothing of the parent', async () => {
  const seen = [];
  const fetchRows = async (path, o = {}) => { seen.push([path, o.method]); return path.startsWith('office_app_users?org_id=eq.' + SIM + '&auth_user_id=eq.u1') && !o.method ? [{ role: 'owner' }] : []; };
  const out = await archiveSimulation(user, SIM, { fetchRows, audit });
  assert.equal(out.archived, true);
  assert.ok(seen.some(([p, m]) => m === 'PATCH' && p.startsWith('office_app_users?org_id=eq.' + SIM)));
  assert.ok(!seen.some(([p]) => p.includes(PARENT)));
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/simulation.test.js`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Écrire `lib/simulation.js`**

```js
import { rest } from './supabase.js';
import { trainingDrive } from './training-drive.js';
import { fitName } from './path-budget.js';

// Simulation = a training firm, child of the real firm (2026-11-18). Same engine, isolated data.
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const text = (v, code, max = 120) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); if (!t || t.length > max) throw fail(code); return t; };
const SQL_CODES = ['NOT_IN_PARENT', 'PARENT_IS_SIMULATION', 'INVALID_SIMULATION', 'SERVER_ONLY'];
const sqlCode = e => SQL_CODES.find(c => String(e?.message || '').includes(c));
const defaultAudit = async () => {};

export async function createSimulation(user, parentOrg, body = {}, d = {}) {
  if (!user?.email_confirmed_at || user.is_anonymous === true) throw fail('EMAIL_NOT_VERIFIED', 403);
  const name = text(body.name, 'SIMULATION_NAME_REQUIRED');
  const fetchRows = d.fetchRows || rest, drive = d.drive || trainingDrive;
  const displayName = text(user.user_metadata?.display_name || String(user.email || '').split('@')[0], 'INVALID_NAME');
  let out;
  try {
    out = await fetchRows('rpc/office_create_simulation', { method: 'POST', body: JSON.stringify({ p_auth_user_id: user.id, p_parent_org: parentOrg, p_name: name, p_display_name: displayName }) });
  } catch (e) { const c = sqlCode(e); throw c ? fail(c, c === 'NOT_IN_PARENT' ? 403 : 400) : e; }
  out = Array.isArray(out) ? out[0] : out;
  if (!out?.org_id) throw fail('SIMULATION_SETUP_FAILED', 500);
  if (out.created === false) return { org_id: out.org_id, name, folder_id: null, created: false };
  // The Drive folder under « Entraînements » of the PARENT firm's Drive; the simulation's Drive IS that folder.
  const parent = drive.defaultParent();
  if (!parent) throw fail('TRAINING_PARENT_REQUIRED', 400);
  const folderName = fitName(['SIMULATION', name, new Date().toISOString().slice(0, 10)].join(' — '));
  const folder = await drive.createFolder(parent, folderName);
  await fetchRows('office_firm_drive?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: out.org_id, drive_id: 'folder:' + folder.id, drive_name: folderName }]) });
  await (d.audit || defaultAudit)(out.org_id, 'SIMULATION_CREATED', user.email, { parent: parentOrg, name, source: body.source || null, folder: folder.id });
  return { org_id: out.org_id, name, folder_id: folder.id, created: true };
}

export async function listSimulations(user, parentOrg, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const orgs = await fetchRows('office_organizations?parent_org_id=eq.' + q(parentOrg) + '&account_kind=eq.simulation&select=id,name,created_at&order=created_at.desc&limit=200') || [];
  if (!orgs.length) return [];
  const mine = await fetchRows('office_app_users?auth_user_id=eq.' + q(user.id) + '&org_id=in.(' + orgs.map(o => q(o.id)).join(',') + ')&select=org_id,role,active&limit=500') || [];
  const by = new Map(mine.map(m => [m.org_id, m]));
  return orgs.filter(o => by.has(o.id)).map(o => ({ org_id: o.id, name: o.name, role: by.get(o.id).role, created_at: o.created_at, archived: by.get(o.id).active === false }));
}

export async function archiveSimulation(user, simOrg, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const me = (await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=role&limit=1'))?.[0];
  if (!me || me.role !== 'owner') throw fail('NOT_SIMULATION_OWNER', 403);
  await fetchRows('office_app_users?org_id=eq.' + q(simOrg), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) });
  await (d.audit || defaultAudit)(simOrg, 'SIMULATION_ARCHIVED', user.email, {});
  return { archived: true };
}
```

Vérifier que `fitName` est bien exporté par `lib/path-budget.js` (`grep -n "export function fitName" lib/path-budget.js`) et que sa signature accepte une chaîne seule ; sinon l'appeler comme `fitName(folderName, '')` selon l'export réel (lire 10 lignes autour avec Read).

- [ ] **Step 4: `myCabinets` renvoie le type**

Dans `lib/cabinet-onboarding.js:34-41`, changer `select=id,name` en `select=id,name,account_kind`, et le tableau retourné : `({ org_id: r.org_id, name: …, role: r.role, account_kind: kinds.get(r.org_id) || null })` avec `const kinds = new Map(orgs.map(o => [o.id, o.account_kind]));`. Les tests `cabinet-onboarding*.test.js` (fausse base qui répond `[{ id, name }]`) restent valides.

- [ ] **Step 5: Lancer les tests**

Run: `node --test tests/simulation.test.js tests/cabinet-onboarding.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/simulation.js lib/cabinet-onboarding.js tests/simulation.test.js
git commit -m "Simulation: création, liste et archivage d'un cabinet fils"
```

---

### Task 5: Route `simulation`, amorçage du type, planificateur

**Files:**
- Modify: `api/app.js` (amorçage après `resolveRequestOrg` ligne ~1319 ; route `simulation` près de `cabinets` ligne 440 ; boucle `scheduler-tick` ligne ~524)
- Test: `tests/simulation-routes.test.js`

**Interfaces:**
- Consumes: `createSimulation`, `listSimulations`, `archiveSimulation` (tâche 4) ; `primeOrgKind` (tâche 2).
- Produces : `GET /api/app?route=simulation` → `{ simulations: [...], parent: <org> }` ; `POST` `{ action: 'create', name, source }` → résultat de `createSimulation` ; `{ action: 'archive', org_id }` → `{ archived: true }`. Toutes exigent `multiCabinet()` (sinon 503 `CABINETS_NOT_ENABLED`) et une session personnelle (`sessionUser`). La création se fait toujours sous le cabinet courant `orgId` ; si le cabinet courant est lui-même une simulation → `PARENT_IS_SIMULATION`.

- [ ] **Step 1: Écrire les tests qui échouent**

Le test charge la source de `api/app.js` (comme les autres tests de routes ; voir `grep -ln "api/app.js" tests/*.js | head -3` pour le style existant et le réutiliser pour l'appel de handlers) et vérifie :

```js
// tests/simulation-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../api/app.js', import.meta.url), 'utf8');

test('the simulation route exists, needs several firms and a personal session', () => {
  const i = app.indexOf('  simulation: {');
  assert.ok(i > 0, 'route simulation declared');
  const block = app.slice(i, i + 1600);
  assert.match(block, /CABINETS_NOT_ENABLED/);
  assert.match(block, /sessionUser/);
  assert.match(block, /createSimulation/);
  assert.match(block, /archiveSimulation/);
});

test('the firm type is primed right after the firm of the request is fixed (signed internal calls included)', () => {
  const j = app.indexOf('await resolveRequestOrg(req');
  assert.ok(j > 0);
  assert.match(app.slice(j, j + 400), /primeOrgKind\(orgId\)/);
});

test('the scheduler skips simulation firms', () => {
  const k = app.indexOf("'scheduler-tick'");
  const block = app.slice(k, k + 1200);
  assert.match(block, /account_kind/);
  assert.match(block, /simulation/);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/simulation-routes.test.js`
Expected: FAIL (les trois assertions).

- [ ] **Step 3: Amorçage du type de cabinet**

Juste après la ligne `const orgId = await resolveRequestOrg(req, { requireMember: !run.public });` (api/app.js ~1319), ajouter :

```js
  if (orgId && multiCabinet()) await (await import('../lib/simulation-guard.js')).primeOrgKind(orgId).catch(() => null);
```
(Hors multi-cabinet : un seul cabinet réel, aucun amorçage ; les garde-fous d'envoi ne refusent que les types lus.)

- [ ] **Step 4: Route `simulation`**

Après le bloc `cabinets` (ligne ~440-460), ajouter (Edit sur l'ancre `  cabinets: {` pour l'insérer avant) :

```js
  simulation: {
    GET: open(async (orgId, req) => {
      if (!multiCabinet()) throw fail('CABINETS_NOT_ENABLED', 503);
      const s = await import('../lib/simulation.js'), u = await import('../lib/user-auth.js');
      return { parent: orgId, simulations: await s.listSimulations(await u.sessionUser(req), orgId) };
    }),
    POST: open(async (orgId, req) => {
      if (!multiCabinet()) throw fail('CABINETS_NOT_ENABLED', 503);
      const s = await import('../lib/simulation.js'), u = await import('../lib/user-auth.js');
      const b = req.body || {}, action = String(b.action || '');
      if (action === 'create') return s.createSimulation(await u.sessionUser(req), orgId, b);
      if (action === 'archive') return s.archiveSimulation(await u.sessionUser(req), String(b.org_id || ''));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'SIMULATION_UNAVAILABLE'
  },
```
Conserver exactement le style de `cabinets` (même `open`, mêmes `fail`/`sessionUser`). Si le cabinet courant est une simulation, la fonction SQL lève `PARENT_IS_SIMULATION` (testé en tâche 1/4).

- [ ] **Step 5: Le planificateur saute les simulations**

Dans le bloc `scheduler-tick` multi-cabinet, changer la lecture des cabinets :

```js
    const firms = (await rest('office_organizations?select=id,account_kind&order=created_at.asc&limit=1000') || []).filter(f => f.account_kind !== 'simulation');
```

- [ ] **Step 6: Lancer les tests**

Run: `node --test tests/simulation-routes.test.js tests/firm-context.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/app.js tests/simulation-routes.test.js
git commit -m "Simulation: route, amorçage du type de cabinet, planificateur qui les saute"
```

---

### Task 6: Interface — onglet Simulation, bandeau, sortie

**Files:**
- Create: `assets/simulation.js`
- Modify: `entrainement.html` (bouton d'onglet + panneau), `assets/brand-theme.js` (bandeau), `tests/ui-pilot-hooks.test.js` (empreinte de `entrainement.html`)
- Test: `tests/simulation-ui.test.js`

**Interfaces:**
- Consumes: `OM.api`, `OM.getSession`, `OM.switchCabinet(orgId, redirectUrl)` (`assets/brand-theme.js`), route `simulation` et `cabinets` (champ `account_kind`, `current`).
- Produces : onglet `data-training-view="simulation"` + panneau `#training-simulation` ; `window.OMSimulation.init()` ; bandeau `#om-simulation-banner` (injecté par `brand-theme.js` quand le cabinet courant est de type `simulation`) avec le bouton `#om-simulation-leave`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// tests/simulation-ui.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Entraînement offers a Simulation tab and loads the simulation script', () => {
  const h = read('entrainement.html');
  assert.match(h, /data-training-view="simulation"/);
  assert.match(h, /id="training-simulation"/);
  assert.match(h, /src="\/assets\/simulation\.js"/);
});

test('the banner and the way out exist and say the simulation is not real', () => {
  const b = read('assets/brand-theme.js');
  assert.match(b, /om-simulation-banner/);
  assert.match(b, /Mode Simulation/);
  assert.match(b, /om-simulation-leave/);
});

test('the simulation script never builds HTML from server text (textContent only)', () => {
  const s = read('assets/simulation.js');
  assert.doesNotMatch(s, /innerHTML\s*=/);
  assert.match(s, /route=simulation/);
  assert.match(s, /switchCabinet/);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test tests/simulation-ui.test.js`
Expected: FAIL.

- [ ] **Step 3: Onglet et panneau dans `entrainement.html`**

Après le bouton `data-training-view="shadow"` (ligne 76) ajouter :
`<button type="button" class="btn ghost" data-training-view="simulation" aria-controls="training-simulation" aria-pressed="false">Simulation</button>`
Après la section `training-shadow` (qui se ferme avant le `</main>`), ajouter :

```html
    <section id="training-simulation" class="training-panel" aria-labelledby="training-simulation-title" hidden>
      <h2 id="training-simulation-title">Simulation</h2>
      <p class="meta">Travaillez dans Firm Manager comme sur une vraie mission, dans un cabinet d'entraînement séparé : vos données, vos rôles et vos travaux n'ont aucun effet sur le vrai cabinet. Rien n'est envoyé à l'extérieur.</p>
      <div id="simulation-list"></div>
      <form id="simulation-form" class="card">
        <div class="field"><label for="simulation-name">Nom de la simulation</label><input id="simulation-name" maxlength="120" required placeholder="ex. Entraînement — Société Atlas 2024"></div>
        <div class="field"><label for="simulation-client">Ancienne mission (client)</label><input id="simulation-client" maxlength="120"></div>
        <div class="field"><label for="simulation-period">Exercice</label><input id="simulation-period" maxlength="40" placeholder="2024"></div>
        <button type="submit" class="btn" id="simulation-create">Créer la simulation</button>
        <p class="status" id="simulation-say" role="status" aria-live="polite"></p>
      </form>
    </section>
```
Vérifier que le mécanisme existant de bascule des onglets (`data-training-view`) gère une 4ᵉ vue sans changement (lire le script de `entrainement.html` autour de `trainingView` avec Grep ; si les vues sont listées en dur, ajouter `'simulation'` à la liste avec Edit). Ajouter avant `</body>` : `<script src="/assets/simulation.js" defer></script>`.

- [ ] **Step 4: `assets/simulation.js`**

```js
(function () {
  var OM = window.OfficeManager, $ = function (id) { return document.getElementById(id); };
  if (!OM || !$('training-simulation')) return;
  var ERR = { CABINETS_NOT_ENABLED: 'Le mode plusieurs cabinets n’est pas encore activé sur ce serveur.', NOT_IN_PARENT: 'Vous n’êtes pas membre de ce cabinet.',
    PARENT_IS_SIMULATION: 'Quittez la simulation avant d’en créer une autre.', TRAINING_PARENT_REQUIRED: 'Le dossier « Entraînements » du Drive n’est pas connu : connectez le Drive du cabinet.',
    GOOGLE_NOT_CONNECTED: 'Connectez Google (Paramètres) avant de créer une simulation.', EMAIL_NOT_VERIFIED: 'Confirmez votre adresse e-mail.',
    SIMULATION_NAME_REQUIRED: 'Donnez un nom à la simulation.' };
  var msg = function (e) { var m = (e && (e.code || e.message)) || String(e); return ERR[m] || m; };
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  function paint(list) {
    var box = $('simulation-list'); box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'Aucune simulation pour l’instant.', 'empty')); return; }
    list.forEach(function (s) {
      var row = el('div', null, 'item');
      var t = el('div', null, 't'); t.appendChild(el('span', s.name)); t.appendChild(el('span', (s.archived ? 'archivée' : 'rôle : ' + s.role), 'meta')); row.appendChild(t);
      if (!s.archived) {
        var go = el('button', 'Entrer dans la simulation', 'btn'); go.type = 'button';
        go.addEventListener('click', function () { OM.switchCabinet(s.org_id, '/accueil.html'); });
        row.appendChild(go);
      }
      box.appendChild(row);
    });
  }
  function load() { OM.api('/api/app?route=simulation').then(function (d) { paint(d.simulations || []); }).catch(function (e) { $('simulation-say').textContent = msg(e); }); }

  $('simulation-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var b = $('simulation-create'), say = $('simulation-say'); b.disabled = true; say.className = 'status'; say.textContent = 'Création en cours…';
    OM.api('/api/app?route=simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: $('simulation-name').value, source: { client: $('simulation-client').value, period: $('simulation-period').value } }) })
      .then(function (r) { say.textContent = r.created === false ? 'Cette simulation existe déjà.' : 'Simulation créée.'; load(); })
      .catch(function (e) { say.className = 'status error'; say.textContent = msg(e); })
      .then(function () { b.disabled = false; });
  });
  window.OMSimulation = { init: load };
  load();
})();
```

- [ ] **Step 5: Bandeau et sortie dans `assets/brand-theme.js`**

Repérer dans `brand-theme.js` la fonction qui injecte la barre du haut (`.om-workspace-toolbar`, Grep `om-workspace-toolbar`) et le helper `OM.switchCabinet`. Ajouter une fonction `addSimulationBanner()` appelée une fois au chargement (à côté de `addDossierNavigation()`) :

```js
  function addSimulationBanner() {
    var s = readSession(); if (!s || !s.org_id) return;
    OM.api('/api/app?route=cabinets').then(function (d) {
      var cur = (d.cabinets || []).filter(function (c) { return c.org_id === d.current; })[0];
      if (!cur || cur.account_kind !== 'simulation' || document.getElementById('om-simulation-banner')) return;
      var bar = node('div', null, 'om-simulation-banner'); bar.id = 'om-simulation-banner'; bar.setAttribute('role', 'status');
      bar.appendChild(node('strong', 'Mode Simulation'));
      bar.appendChild(document.createTextNode(' — rien n’est réel : vos données et vos rôles ne touchent pas le vrai cabinet.'));
      var leave = node('button', 'Quitter la simulation', 'btn ghost'); leave.type = 'button'; leave.id = 'om-simulation-leave';
      leave.addEventListener('click', function () {
        var real = (d.cabinets || []).filter(function (c) { return c.account_kind !== 'simulation'; })[0];
        if (real) OM.switchCabinet(real.org_id, '/entrainement.html');
      });
      bar.appendChild(leave);
      var host = document.querySelector('.main') || document.body; host.insertBefore(bar, host.firstChild);
    }).catch(function () {});
  }
```
Utiliser les helpers réellement présents dans le fichier (`node` / `readSession` : Grep pour confirmer leurs noms ; sinon `document.createElement`). N'ajouter le bandeau que si la session a un `org_id` (cabinets multiples activés). Style : dans `assets/ui/kit.css` ajouter `.om-design .om-simulation-banner { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; padding:.5rem .75rem; border:1px solid var(--om-warning, #f59f0a); background: var(--om-warning-bg, #fef3c7); border-radius: var(--radius); color: var(--foreground); }` puis `npm run build:css`.

- [ ] **Step 6: Mettre à jour l'empreinte volontairement**

Run: `node --test tests/ui-pilot-hooks.test.js`
Expected: FAIL sur `entrainement.html` seulement, avec le nouveau hash dans le message. Vérifier que les seuls nouveaux `id` sont ceux ajoutés ci-dessus (`training-simulation`, `training-simulation-title`, `simulation-list`, `simulation-form`, `simulation-name`, `simulation-client`, `simulation-period`, `simulation-create`, `simulation-say`) et le `data-training-view`; alors remplacer l'ancienne empreinte `498594ee…` par la nouvelle dans `tests/ui-pilot-hooks.test.js` (Edit). Ne changer aucune autre empreinte.

- [ ] **Step 7: Lancer les tests**

Run: `npm run build:css && node --test tests/simulation-ui.test.js tests/ui-pilot-hooks.test.js tests/ui-css-up-to-date.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add assets/simulation.js entrainement.html assets/brand-theme.js assets/ui/kit.css assets/ui.css tests/simulation-ui.test.js tests/ui-pilot-hooks.test.js
git commit -m "Simulation: onglet Entraînement, bandeau de mode et sortie"
```

---

### Task 7: Isolation de bout en bout (tests de non-régression)

**Files:**
- Test: `tests/simulation-isolation.test.js`

**Interfaces:** consomme `runInFirm`, `primeOrgKind`, `assertNoOutbound`, `sendViaGmail`, `assertWritableTarget`, `resolveRequestOrg`.

- [ ] **Step 1: Écrire les tests**

```js
// tests/simulation-isolation.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm, resolveRequestOrg } from '../lib/firm-context.js';
import { primeOrgKind, resetSimulationGuardCache } from '../lib/simulation-guard.js';
import { sendViaGmail } from '../lib/agent-mail.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive')) return [{ drive_id: 'folder:F' }];
  throw new Error('unexpected ' + path);
};

test('sendViaGmail refuses in a simulation before any network call', async () => {
  resetSimulationGuardCache(); await primeOrgKind(SIM, { fetchRows });
  let called = false;
  await runInFirm(SIM, async () => {
    await assert.rejects(sendViaGmail({ recipients: ['x@y.test'], subject: 's', body: 'b' }, {}, { fetchImpl: async () => { called = true; return { ok: true }; } }), /SIMULATION_NO_OUTBOUND/);
  });
  assert.equal(called, false);
});

test('a member of the simulation only (no parent membership) cannot reach the parent firm', async () => {
  const env = { OFFICE_MANAGER_MULTI_CABINET: 'on', DEFAULT_ORG_ID: REAL };
  const req = { headers: { 'x-office-manager-org': REAL } };
  const onlySim = async (r, { orgId }) => { if (orgId === SIM) return { role: 'owner' }; throw new Error('NOT_IN_THIS_CABINET'); };
  await assert.rejects(resolveRequestOrg(req, { env, currentAccount: onlySim }), /NOT_IN_THIS_CABINET/);
  const ok = await resolveRequestOrg({ headers: { 'x-office-manager-org': SIM } }, { env, currentAccount: onlySim });
  assert.equal(ok, SIM);
});

test('a role held in the simulation is not a role of the parent (the account is resolved per firm)', async () => {
  const env = { OFFICE_MANAGER_MULTI_CABINET: 'on', DEFAULT_ORG_ID: REAL };
  const perFirm = async (r, { orgId }) => ({ role: orgId === SIM ? 'owner' : 'auditor', orgId });
  const reqSim = { headers: { 'x-office-manager-org': SIM } }, reqReal = { headers: { 'x-office-manager-org': REAL } };
  await resolveRequestOrg(reqSim, { env, currentAccount: perFirm });
  await resolveRequestOrg(reqReal, { env, currentAccount: perFirm });
  assert.equal(reqSim.account.role, 'owner');
  assert.equal(reqReal.account.role, 'auditor');
});
```

- [ ] **Step 2: Lancer**

Run: `node --test tests/simulation-isolation.test.js`
Expected: PASS (les gardes des tâches 2 et 5 sont en place ; le troisième test vérifie que le rôle vient du cabinet de la requête, comportement existant).

- [ ] **Step 3: Commit**

```bash
git add tests/simulation-isolation.test.js
git commit -m "Simulation: tests d'isolation (envoi, appartenance, rôles par cabinet)"
```

---

### Task 8: Documentation, activation des cabinets multiples, suite complète

**Files:**
- Modify: `docs/A_FAIRE_DE_VOTRE_COTE.txt`, `CLAUDE.md`, `docs/INSTALLER_SUR_UN_VPS.md` (une ligne : variables)

**Interfaces:** aucune ; livre les consignes à Paul.

- [ ] **Step 1: Consignes de Paul**

Ajouter en haut de `docs/A_FAIRE_DE_VOTRE_COTE.txt` (Edit sur la première ligne du fichier ; lire d'abord 15 lignes avec Read) une section datée 2026-11-18 « Activer les cabinets multiples (Simulation) » contenant, pas à pas :
1. Se connecter au serveur : `ssh ionos-office`.
2. Dans le dossier de l'application, éditer `.env` et ajouter : `OFFICE_MANAGER_MULTI_CABINET=on` (facultatif : `OFFICE_MANAGER_SIMULATION_AI_DAILY_LIMIT=200`). Vérifier que `DEFAULT_ORG_ID` est déjà renseigné (c'est le cabinet actuel).
3. Redémarrer : la commande exacte de `docs/INSTALLER_SUR_UN_VPS.md` (lire la section « mise à jour / redémarrage » avant de la recopier ; ne pas inventer).
4. Contrôles : ouvrir `https://office.eynowa.com/api/health` (doit répondre `status: ok`) ; se connecter avec un compte existant (doit arriver sur l'accueil du cabinet actuel, pas sur « Mes cabinets ») ; ouvrir Entraînement → Simulation → créer une simulation de test ; vérifier le bandeau « Mode Simulation » et le dossier créé dans « Entraînements ».
5. Retour arrière : retirer la ligne et redémarrer.
Rappeler que le déploiement automatique ne touche jamais `.env`.

- [ ] **Step 2: Mémoire de projet**

Ajouter dans `CLAUDE.md`, section « Plusieurs cabinets dans une installation », un paragraphe daté 2026-11-18 : Simulation = cabinet fils (`account_kind = 'simulation'`, `parent_org_id`), `lib/simulation.js`, `lib/simulation-guard.js` (échec fermé ; aucun envoi, Drive confiné, plafond d'IA 200/jour), connexion Google empruntée au parent dans `loadGoogleConnection`, planificateur qui saute les simulations, route `simulation`, onglet Entraînement → Simulation ; spec `docs/superpowers/specs/2026-11-18-simulation-cabinet-design.md` ; tests `tests/simulation*.test.js` ; non essayé avec le vrai Google, la vraie IA ni le vrai serveur ; étapes 2 à 5 non faites.

- [ ] **Step 3: Suite complète**

Run: `npm test > /tmp/x.out 2>&1; grep -E "^ℹ (tests|pass|fail)" /tmp/x.out; grep -E "^not ok|✖" /tmp/x.out | head`
Expected: `fail 0`. Si un test existant échoue, le dire par son nom et corriger la cause avant de continuer (systematic-debugging).

- [ ] **Step 4: Commit**

```bash
git add docs/A_FAIRE_DE_VOTRE_COTE.txt CLAUDE.md docs/INSTALLER_SUR_UN_VPS.md
git commit -m "Simulation: consignes d'activation des cabinets multiples et mémoire de projet"
```

---

## Auto-revue

- **Couverture de la spec :** section 4 (SQL) → tâche 1 ; section 5 (parcours) → tâches 4, 5, 6 ; section 6 (Google emprunté, garde Drive) → tâches 2 et 3 ; section 7 (garde-fous : envoi, planificateur, IA, droits, parent, fils d'un fils) → tâches 2, 5, 7 et SQL (tâche 1) ; mémoire des agents séparée → héritée du Drive du fils (`ensureMemoryHome` lit le Drive du cabinet courant), testée indirectement par l'isolation du Drive en tâche 2 — **à vérifier en recette** (non couvert par un test dédié, annoncé dans la limite) ; section 8 (activation) → tâche 8 ; section 10 (tests) → couverts.
- **Limites annoncées :** la mémoire des agents du fils n'a pas de test dédié ; la création réelle du dossier Drive, l'emprunt Google et l'IA ne sont pas essayés tant que l'activation n'est pas faite sur le serveur.
- **Cohérence des noms :** `primeOrgKind`, `isSimulation`, `isSimulationKnown`, `assertNoOutbound`, `assertSimulationDriveWrite`, `createSimulation`, `listSimulations`, `archiveSimulation`, `office_create_simulation`, `parent_org_id` sont identiques dans toutes les tâches.
