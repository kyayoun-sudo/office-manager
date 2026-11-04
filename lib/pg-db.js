// The firm's own PostgreSQL (VPS, 2026-11-04): one pool for the whole server, one transaction per request.
// DATABASE_URL=postgres://user:password@host:5432/office_manager. Never logged.
let pool = null;

export const databaseConfigured = () => Boolean(process.env.DATABASE_URL);

async function getPool() {
  if (pool) return pool;
  const { default: pg } = await import('pg');
  // json / jsonb come back as JSON text parsed by us, timestamps stay strings: the same shapes PostgREST gave.
  for (const oid of [1082, 1114, 1184, 1083, 1266]) pg.types.setTypeParser(oid, v => v);
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', e => console.warn('[pg] idle client error:', e.message));
  return pool;
}

export const pgDb = {
  statementTimeout: process.env.DATABASE_STATEMENT_TIMEOUT || '60s',
  // service_role (db/vps-compat.sql): the grants of the installed SQL and the mission journal's actor attribution expect it.
  role: process.env.DATABASE_SET_ROLE === 'none' ? null : (process.env.DATABASE_SET_ROLE || 'service_role'),
  async query(sql, params = []) { return (await (await getPool()).query(sql, params)).rows; },
  async transaction(fn) {
    const client = await (await getPool()).connect();
    try {
      await client.query('begin');
      const out = await fn(async (sql, params = []) => (await client.query(sql, params)).rows);
      await client.query('commit');
      return out;
    } catch (e) { await client.query('rollback').catch(() => null); throw e; }
    finally { client.release(); }
  }
};

export async function closeDatabase() { if (pool) { const p = pool; pool = null; await p.end(); } }
