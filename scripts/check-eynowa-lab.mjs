// Diagnostic EYNOWA Lab — LECTURE SEULE (2026-11-21, avant l'étape 5 de la Simulation).
// Il dit : ce qui est configuré (oui / non, jamais une valeur), quelle version du gateway répond, si la mémoire sémantique répond.
// Il n'écrit rien dans le Lab, n'affiche aucune clé ni aucune adresse complète.
// Usage sur le serveur :  docker compose exec -T app node scripts/check-eynowa-lab.mjs [--probe]
//   --probe : ajoute UNE recherche en lecture dans la mémoire sémantique (aucune écriture) pour savoir si elle répond.
const env = process.env;
const clean = v => String(v || '').trim().replace(/\/+$/, '');
const yes = v => (v ? 'oui' : 'non');
const probe = process.argv.includes('--probe');
const url = clean(env.EYNOWA_LAB_URL), key = String(env.EYNOWA_LAB_API_KEY || '').trim();
const broker = Boolean(clean(env.EYNOWA_BROKER_URL) && String(env.EYNOWA_BROKER_KEY || '').trim());

console.log('EYNOWA Lab — diagnostic en lecture seule');
console.log('- adresse directe du gateway configurée :', yes(url));
console.log('- clé du gateway configurée            :', yes(key));
console.log('- broker Cloudflare configuré          :', yes(broker), broker ? '(le broker ne transporte que le chat : le stockage direct est alors refusé par l’application)' : '');
console.log('- clé d’application v1 configurée      : non vérifiable ici (elle n’existe pas encore dans ce code)');
if (!url) { console.log('\nConclusion : aucun accès direct au gateway n’est configuré ici. Rien à tester.'); process.exit(0); }
let host = '?'; try { host = new URL(url).protocol + '//' + new URL(url).hostname; } catch { /* keep ? */ }
console.log('- gateway (domaine seulement)          :', host);

async function call(path, { method = 'GET', auth = false, body } = {}) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(url + path, { method, signal: c.signal, headers: { Accept: 'application/json', ...(auth && key ? { Authorization: 'Bearer ' + key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = JSON.parse(await r.text()); } catch { /* not json */ }
    return { status: r.status, data };
  } catch (e) { return { status: c.signal.aborted ? 'délai dépassé' : 'injoignable', data: null }; } finally { clearTimeout(t); }
}

const livez = await call('/livez');
const v1 = livez.status === 200 && livez.data?.contract;
console.log('\nGET /livez (sans clé)  :', livez.status, v1 ? '→ contrat ' + livez.data.contract + ' : gateway v1' : '→ pas de /livez : gateway ancien (ou injoignable)');
const health = key ? await call('/health', { auth: true }) : { status: 'non essayé (pas de clé)', data: null };
console.log('GET /health (avec clé)  :', health.status, health.data && typeof health.data === 'object' ? '→ champs : ' + Object.keys(health.data).join(', ') : '');
if (health.status === 401) console.log('  La clé configurée est refusée par le gateway.');
if (probe) {
  const s = key ? await call('/memory/semantic-search', { method: 'POST', auth: true, body: { query: 'diagnostic', limit: 1 } }) : { status: 'non essayé (pas de clé)' };
  console.log('POST /memory/semantic-search (lecture, 1 résultat) :', s.status, s.status === 200 ? '→ la mémoire sémantique répond' : '→ la mémoire sémantique ne répond pas ainsi');
} else console.log('Mémoire sémantique : non testée (relancer avec --probe pour une recherche en lecture).');

console.log('\nLecture :');
console.log(v1 ? '- Gateway v1 détecté : le stockage validé par un humain (/v1/memory/remember) est possible, sous réserve d’une clé d’application.' : '- Gateway ancien : pas de validation humaine ni de séparation par cabinet dans le stockage. Ne rien transférer.');
console.log('- Ce diagnostic ne prouve pas la qualité du Lab ni de ses mémoires.');
