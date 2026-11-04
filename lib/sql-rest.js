// PostgREST-compatible requests on a plain PostgreSQL (2026-11-04, Paul: « je ne veux plus utiliser supabase et vercel »).
// The 120+ files that call rest('<table>?org_id=eq.…&select=…', { method, headers: { Prefer }, body }) do not change: this module
// reads the same URL, builds ONE parameterised SQL statement and answers with the same JSON and the same error shapes
// (SUPABASE_<status>: {"code","details","hint","message"}), so the callers' checks (PGRST205, 42703, 23505…) keep working.
// Supported (census of the code, 2026-11-04): filters eq neq gt gte lt lte like ilike in is cs cd ov, their not.X, or=(…)/and=(…)
// nested, JSON paths (a->b->>c) in filters/select/order, select aliases and casts, order (asc/desc, nullsfirst/last), limit, offset,
// POST (insert, on_conflict + resolution=merge-duplicates|ignore-duplicates), PATCH, DELETE, return=minimal|representation, rpc/<fn>.
// Not supported (never used by the code): embedded resources, count headers, Range. They are refused, never guessed.
// Every identifier is checked against the live catalogue and double-quoted; every value is a bound parameter.

export class RestError extends Error {
  constructor(status, body) { super(`SUPABASE_${status}: ${JSON.stringify(body)}`); this.statusCode = status; this.body = body; }
}
const err = (status, code, message, details = null, hint = null) => new RestError(status, { code, details, hint, message });
const quoteId = s => '"' + String(s).replace(/"/g, '""') + '"';

// ---- catalogue -------------------------------------------------------------------------------------------------------------
export async function loadCatalog(query) {
  const cols = await query(`select c.table_name, c.column_name, c.udt_name, c.data_type from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type in ('BASE TABLE','VIEW') order by c.table_name, c.ordinal_position`, []);
  const pks = await query(`select tc.table_name, kcu.column_name from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position`, []);
  const fns = await query(`select p.proname as name, p.proretset as retset, t.typtype as rettype_kind, t.typname as rettype,
    coalesce(p.proargnames, '{}') as argnames, coalesce(p.proargmodes::text[], '{}') as argmodes,
    array(select format_type(x, null) from unnest(p.proargtypes) x) as argtypes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public'`, []);
  const tables = new Map();
  for (const c of cols) {
    if (!tables.has(c.table_name)) tables.set(c.table_name, { columns: new Map(), pk: [] });
    tables.get(c.table_name).columns.set(c.column_name, { udt: c.udt_name, type: c.data_type });
  }
  for (const p of pks) tables.get(p.table_name)?.pk.push(p.column_name);
  const functions = new Map();
  for (const f of fns) {
    const modes = f.argmodes || [];
    const names = f.argnames || [];
    // Only input arguments are named in a call (OUT / TABLE columns are not).
    const inputs = names.map((n, i) => ({ name: n, mode: modes[i] || 'i' })).filter(a => ['i', 'b', 'v'].includes(a.mode));
    functions.set(f.name, { retset: f.retset, composite: f.rettype_kind === 'c' || (modes.some(m => m === 'o' || m === 't')), void: f.rettype === 'void',
      args: inputs.map((a, i) => ({ name: a.name, type: (f.argtypes || [])[i] || 'text' })) });
  }
  return { tables, functions, at: Date.now() };
}

// ---- small parsers -----------------------------------------------------------------------------------------------------------
// Splits on a separator at depth 0, outside double quotes.
function splitTop(s, sep = ',') {
  const out = []; let depth = 0, quoted = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && quoted && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth--;
    if (ch === sep && depth === 0 && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const unquote = v => (/^".*"$/s.test(v) ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v);

// Query string → ordered list of [key, value]; '+' stays literal (the code always encodes values).
function parseQuery(qs) {
  if (!qs) return [];
  return qs.split('&').filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? '' : pair.slice(i + 1);
    const dec = x => { try { return decodeURIComponent(x); } catch { return x; } };
    return [dec(k), dec(v)];
  });
}

// A column reference: name, optional JSON path (->, ->>), optional cast. Returns SQL and the base column.
function columnRef(spec, table, cat, params, { qualify = true } = {}) {
  let s = String(spec).trim(), cast = null;
  const castAt = s.indexOf('::');
  if (castAt > 0) { cast = s.slice(castAt + 2); s = s.slice(0, castAt); if (!/^[a-z_][a-z0-9_ ]*(\[\])?$/i.test(cast)) throw err(400, 'PGRST100', `invalid cast "${cast}"`); }
  const parts = s.split(/(->>|->)/);
  const base = parts[0];
  if (!cat.tables.get(table)?.columns.has(base)) throw err(400, '42703', `column ${table}.${base} does not exist`);
  let sql = (qualify ? quoteId(table) + '.' : '') + quoteId(base), last = base;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i], key = parts[i + 1];
    if (key === undefined || key === '') throw err(400, 'PGRST100', `invalid JSON path in "${spec}"`);
    if (/^-?\d+$/.test(key)) sql += op + key;
    else { params.push(key); sql += op + '$' + params.length + '::text'; }
    last = key;
  }
  if (cast) sql = '(' + sql + ')::' + cast;
  return { sql, base, name: last, json: parts.length > 1, arrow: parts.length > 1 ? parts[parts.length - 2] : null };
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', cs: '@>', cd: '<@', ov: '&&' };
function condition(colSpec, expr, table, cat, params) {
  let negate = false, e = expr;
  if (e.startsWith('not.')) { negate = true; e = e.slice(4); }
  const dot = e.indexOf('.');
  if (dot < 0) throw err(400, 'PGRST100', `"failed to parse filter (${expr})"`);
  const op = e.slice(0, dot), raw = e.slice(dot + 1);
  const col = columnRef(colSpec, table, cat, params);
  // The value arrives as text and is converted to the exact type of what it is compared with (no guessing by the driver).
  const typeOf = () => (col.json ? (col.arrow === '->>' ? 'text' : 'jsonb') : cat.tables.get(table).columns.get(col.base).udt);
  let sql;
  if (op in OPS) {
    params.push(unquote(raw));
    sql = `${col.sql} ${OPS[op]} ($${params.length}::text)::${quoteId(typeOf())}`;
  } else if (op === 'like' || op === 'ilike') {
    params.push(unquote(raw).replace(/\*/g, '%'));
    sql = `(${col.sql})::text ${op === 'like' ? 'like' : 'ilike'} $${params.length}`;
  } else if (op === 'in') {
    const m = raw.match(/^\((.*)\)$/s);
    if (!m) throw err(400, 'PGRST100', `"failed to parse filter (${expr})"`);
    const values = m[1] === '' ? [] : splitTop(m[1]).map(unquote);
    if (!values.length) sql = 'false';
    else {
      params.push(values);
      sql = `${col.sql} = any(($${params.length}::text[])::${quoteId(typeOf().replace(/^_/, ''))}[])`;
    }
  } else if (op === 'is') {
    const v = raw.toLowerCase();
    if (!['null', 'true', 'false', 'unknown', 'not_null'].includes(v)) throw err(400, 'PGRST100', `"failed to parse filter (${expr})"`);
    sql = v === 'not_null' ? `${col.sql} is not null` : `${col.sql} is ${v}`;
  } else throw err(400, 'PGRST100', `unsupported operator "${op}"`);
  return negate ? `not (${sql})` : sql;
}

// or=(a.eq.1,and(b.gt.2,c.is.null),not.d.in.(x,y))
function logicTree(kind, inner, table, cat, params, negate = false) {
  const m = inner.match(/^\((.*)\)$/s);
  if (!m) throw err(400, 'PGRST100', `"failed to parse logic tree (${inner})"`);
  const parts = splitTop(m[1]).map(p => p.trim()).filter(Boolean).map(p => {
    const lt = p.match(/^(not\.)?(or|and)(\(.*\))$/s);
    if (lt) return logicTree(lt[2], lt[3], table, cat, params, Boolean(lt[1]));
    const d = p.indexOf('.');
    if (d < 0) throw err(400, 'PGRST100', `"failed to parse logic tree (${p})"`);
    // column may contain -> paths, which never contain '.'; the first '.' ends the column.
    return condition(p.slice(0, d), p.slice(d + 1), table, cat, params);
  });
  if (!parts.length) return 'true';
  const sql = '(' + parts.join(kind === 'or' ? ' or ' : ' and ') + ')';
  return negate ? `not ${sql}` : sql;
}

function selectList(spec, table, cat, params) {
  if (!spec || spec.trim() === '*') return quoteId(table) + '.*';
  return splitTop(spec).map(item => item.trim()).filter(Boolean).map(item => {
    if (item === '*') return quoteId(table) + '.*';
    let alias = null, expr = item;
    const m = item.match(/^([A-Za-z_][A-Za-z0-9_]*):(?!:)(.+)$/s);
    if (m) { alias = m[1]; expr = m[2]; }
    if (/\(/.test(expr)) throw err(400, 'PGRST100', `embedded resources are not supported ("${item}")`);
    const col = columnRef(expr, table, cat, params);
    return `${col.sql} as ${quoteId(alias || col.name)}`;
  }).join(', ');
}

function orderList(spec, table, cat, params) {
  return splitTop(spec).map(x => x.trim()).filter(Boolean).map(item => {
    const bits = item.split('.');
    let dir = '', nulls = '';
    while (bits.length > 1 && /^(asc|desc|nullsfirst|nullslast)$/.test(bits[bits.length - 1])) {
      const b = bits.pop();
      if (b === 'asc' || b === 'desc') dir = ' ' + b; else nulls = b === 'nullsfirst' ? ' nulls first' : ' nulls last';
    }
    return columnRef(bits.join('.'), table, cat, params).sql + dir + nulls;
  }).join(', ');
}

function preferOf(headers = {}) {
  const raw = Object.entries(headers).find(([k]) => k.toLowerCase() === 'prefer')?.[1] || '';
  const p = {};
  for (const part of String(raw).split(',')) { const [k, v] = part.trim().split('='); if (k) p[k] = v || true; }
  return p;
}

// ---- build ---------------------------------------------------------------------------------------------------------------------
export function buildStatement(path, options = {}, cat) {
  const method = String(options.method || 'GET').toUpperCase();
  const [resource, qs = ''] = String(path).split(/\?(.*)/s);
  const query = parseQuery(qs);
  const prefer = preferOf(options.headers);
  const params = [];

  if (resource.startsWith('rpc/')) {
    const name = resource.slice(4), fn = cat.functions.get(name);
    if (!fn) throw err(404, 'PGRST202', `Could not find the function public.${name} in the schema cache`);
    const args = options.body ? JSON.parse(options.body) : Object.fromEntries(query);
    params.push(JSON.stringify(args || {}));
    const call = fn.args.filter(a => args && Object.hasOwn(args, a.name)).map(a => {
      const v = /^jsonb?$/.test(a.type) ? `($1::jsonb)->${lit(a.name, params)}` : /\[\]$/.test(a.type)
        ? `array(select jsonb_array_elements_text(($1::jsonb)->${lit(a.name, params)}))::${a.type}` : `(($1::jsonb)->>${lit(a.name, params)})::${a.type}`;
      return `${quoteId(a.name)} => ${v}`;
    }).join(', ');
    const fcall = `${quoteId(name)}(${call})`;
    const sql = fn.retset ? `select coalesce(json_agg(r), '[]'::json) as body from ${fcall} r`
      : fn.composite ? `select row_to_json(r) as body from ${fcall} r` : `select to_json(${fcall}) as body`;
    return { sql, params, returns: true, kind: 'rpc' };
  }

  const table = resource;
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !cat.tables.has(table)) throw err(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`);
  const def = cat.tables.get(table);
  let select = null, order = null, limit = null, offset = null, onConflict = null;
  const where = [];
  for (const [k, v] of query) {
    if (k === 'select') select = v;
    else if (k === 'order') order = v;
    else if (k === 'limit') { if (!/^\d+$/.test(v)) throw err(400, 'PGRST100', 'invalid limit'); limit = Number(v); }
    else if (k === 'offset') { if (!/^\d+$/.test(v)) throw err(400, 'PGRST100', 'invalid offset'); offset = Number(v); }
    else if (k === 'on_conflict') onConflict = v.split(',').map(s => s.trim()).filter(Boolean);
    else if (k === 'columns') throw err(400, 'PGRST100', 'columns= is not supported');
    else if (/^(not\.)?(or|and)$/.test(k)) { const m = k.match(/^(not\.)?(or|and)$/); where.push(logicTree(m[2], v, table, cat, params, Boolean(m[1]))); }
    else where.push(condition(k, v, table, cat, params));
  }
  const whereSql = where.length ? ' where ' + where.join(' and ') : '';
  const representation = prefer.return === 'representation';
  const tail = (orderSql => (orderSql ? ' order by ' + orderSql : '') + (limit != null ? ' limit ' + limit : '') + (offset != null ? ' offset ' + offset : ''));

  if (method === 'GET' || method === 'HEAD') {
    const sel = selectList(select, table, cat, params);
    const ord = order ? orderList(order, table, cat, params) : '';
    return { sql: `select coalesce(json_agg(t), '[]'::json) as body from (select ${sel} from ${quoteId(table)}${whereSql}${tail(ord)}) t`, params, returns: true, kind: 'select' };
  }
  const returning = representation ? ` returning ${selectList(select, table, cat, params)}` : '';
  const wrap = sql => (representation ? `with w as (${sql}) select coalesce(json_agg(w), '[]'::json) as body from w` : sql);

  if (method === 'POST') {
    let rows = options.body ? JSON.parse(options.body) : [];
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length) return { sql: null, params, returns: representation, empty: true };
    const keys = Object.keys(rows[0] || {});
    for (const key of keys) if (!def.columns.has(key)) throw err(400, 'PGRST204', `Could not find the '${key}' column of '${table}' in the schema cache`);
    for (const r of rows) if (Object.keys(r || {}).length !== keys.length || Object.keys(r).some(k => !keys.includes(k))) throw err(400, 'PGRST102', 'All object keys must match');
    params.push(JSON.stringify(rows));
    const cols = keys.map(quoteId).join(', ');
    let sql = keys.length
      ? `insert into ${quoteId(table)} (${cols}) select ${cols} from jsonb_populate_recordset(null::${quoteId(table)}, $${params.length}::jsonb)`
      : `insert into ${quoteId(table)} default values`;
    const resolution = prefer.resolution;
    if (resolution === 'merge-duplicates' || resolution === 'ignore-duplicates') {
      const target = onConflict?.length ? onConflict : def.pk;
      for (const c of target) if (!def.columns.has(c)) throw err(400, '42703', `column ${table}.${c} does not exist`);
      const updates = keys.filter(k => !target.includes(k));
      sql += ` on conflict (${target.map(quoteId).join(', ')}) ` + (resolution === 'ignore-duplicates' || !updates.length ? 'do nothing'
        : 'do update set ' + updates.map(k => `${quoteId(k)} = excluded.${quoteId(k)}`).join(', '));
    }
    return { sql: wrap(sql + returning), params, returns: representation, kind: 'insert' };
  }
  if (method === 'PATCH') {
    const body = options.body ? JSON.parse(options.body) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw err(400, 'PGRST102', 'PATCH body must be one object');
    const keys = Object.keys(body);
    for (const key of keys) if (!def.columns.has(key)) throw err(400, 'PGRST204', `Could not find the '${key}' column of '${table}' in the schema cache`);
    if (!keys.length) return { sql: null, params, returns: representation, empty: true };
    params.push(JSON.stringify(body));
    const sql = `update ${quoteId(table)} set ${keys.map(k => `${quoteId(k)} = _om_body.${quoteId(k)}`).join(', ')} from jsonb_populate_record(null::${quoteId(table)}, $${params.length}::jsonb) _om_body${whereSql}`;
    return { sql: wrap(sql + returning), params, returns: representation, kind: 'update' };
  }
  if (method === 'DELETE') return { sql: wrap(`delete from ${quoteId(table)}${whereSql}${returning}`), params, returns: representation, kind: 'delete' };
  throw err(405, 'PGRST117', `Unsupported HTTP method: ${method}`);
}
function lit(value, params) { params.push(value); return `$${params.length}::text`; }

// ---- errors ----------------------------------------------------------------------------------------------------------------------
const STATUS = { '23505': 409, '23503': 409, '40001': 409, '23514': 400, '23502': 400, '22P02': 400, '22007': 400, '22008': 400, '22003': 400,
  '22023': 400, '42703': 400, '42883': 404, '42P01': 404, P0001: 400, '42501': 403, '57014': 500 };
export function fromPgError(e) {
  if (e instanceof RestError) return e;
  if (!e?.code) return e;
  return err(STATUS[e.code] || (String(e.code).startsWith('22') ? 400 : 500), e.code, e.message, e.detail || null, e.hint || null);
}

// ---- run ---------------------------------------------------------------------------------------------------------------------------
// db: { query(sql, params) → rows, transaction(fn(q)) }. actor headers are set for the transaction (the mission change trigger reads them).
export function createSqlRest(db, { catalogTtlMs = 60_000 } = {}) {
  let catalog = null, loading = null;
  async function cat(force = false) {
    if (!force && catalog && Date.now() - catalog.at < catalogTtlMs) return catalog;
    if (!loading) loading = loadCatalog(db.query).then(c => { catalog = c; return c; }).finally(() => { loading = null; });
    return loading;
  }
  async function run(path, options = {}) {
    let c = await cat(), stmt;
    try { stmt = buildStatement(path, options, c); }
    catch (e) {
      // A table, column or function created since the last read of the catalogue (an installed SQL file): read it again once.
      if (e instanceof RestError && ['PGRST205', 'PGRST204', 'PGRST202', '42703'].includes(e.body.code)) { c = await cat(true); stmt = buildStatement(path, options, c); }
      else throw e;
    }
    if (stmt.empty) return stmt.returns ? [] : null;
    const headers = Object.fromEntries(Object.entries(options.headers || {}).filter(([k]) => /^x-office-manager-/i.test(k)).map(([k, v]) => [k.toLowerCase(), String(v)]));
    // auth.uid() (db/vps-compat.sql) = the person whose session the SERVER verified, passed by server code only (never the browser).
    const authUser = headers['x-office-manager-auth-user'] || '';
    if (authUser && !/^[0-9a-f-]{36}$/i.test(authUser)) throw err(400, 'PGRST100', 'invalid auth user');
    delete headers['x-office-manager-auth-user'];
    try {
      const rows = await db.transaction(async q => {
        if (db.role) await q(`set local role ${quoteId(db.role)}`, []);
        await q(`select set_config('request.headers', $1, true), set_config('statement_timeout', $2, true), set_config('request.jwt.claim.sub', $3, true)`,
          [JSON.stringify(headers), String(db.statementTimeout || '60s'), authUser]);
        return q(stmt.sql, stmt.params);
      });
      if (!stmt.returns) return null;
      const body = rows?.[0]?.body;
      return typeof body === 'string' ? JSON.parse(body) : body ?? null;
    } catch (e) { throw fromPgError(e); }
  }
  return { run, catalog: cat };
}
