// Local-only reference laboratory. Never imported by API routes or production agents.
import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createFirm, startFirm, advance } from './firm-simulation.js';

const MARKER = 'OFFICE_MANAGER_SIMULATION_ONLY_V1\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2));
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class SimulationDisk {
  constructor(root) { this.root = path.resolve(root); }
  async assertRoot() {
    if (await readFile(path.join(this.root, '.simulation-only'), 'utf8') !== MARKER) throw new Error('NOT_A_SIMULATION_DIRECTORY');
  }
  async initialize(options = {}) {
    const campaign = createFirm(options);
    campaign.disk_run = { max_actions: options.maxActions ?? 500, actions: 0, known_cost: 0, currency: 'USD', mode: 'reference-only' };
    if (!Number.isInteger(campaign.disk_run.max_actions) || campaign.disk_run.max_actions < 1 || campaign.disk_run.max_actions > 100000) throw new Error('INVALID_ACTION_BUDGET');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await readdir(this.root)).length) throw new Error('SIMULATION_DIRECTORY_MUST_BE_EMPTY');
    await writeFile(path.join(this.root, '.simulation-only'), MARKER, { flag: 'wx', mode: 0o600 });
    await mkdir(path.join(this.root, 'blobs'), { mode: 0o700 });
    await mkdir(path.join(this.root, 'commits'), { mode: 0o700 });
    return this.exclusive(async () => {
      await this.commit(campaign);
      return campaign;
    });
  }
  async exclusive(fn) {
    await this.assertRoot();
    let lock;
    try { lock = await open(path.join(this.root, '.lock'), 'wx', 0o600); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('SIMULATION_LOCKED'); throw e; }
    try { return await fn(); }
    finally { await lock.close(); await unlink(path.join(this.root, '.lock')); }
  }
  async put(bytes) {
    const digest = hash(bytes), target = path.join(this.root, 'blobs', digest);
    try { await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (hash(await readFile(target)) !== digest) throw new Error('SIMULATION_WRITE_READBACK_FAILED');
    return digest;
  }
  async commit(campaign) {
    // All versions remain immutable. HEAD changes only after every file is re-read.
    const files = [];
    for (const mission of campaign.missions) {
      for (const [index, artifact] of mission.artifacts.entries()) {
        const bytes = json({ label: 'SIMULATION — NOT A REAL APPROVAL', ...artifact });
        files.push({ mission_id: mission.id, artifact_id: artifact.id, sequence: index, version: artifact.version, sha256: await this.put(bytes), bytes: bytes.length });
      }
    }
    const checkpoint = await this.put(json(campaign));
    const manifest = { simulation_only: true, checkpoint, files, revision: campaign.revision };
    const id = hash(json(manifest));
    const target = path.join(this.root, 'commits', id + '.json');
    const body = json(manifest);
    try { await writeFile(target, body, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (hash(await readFile(target)) !== id) throw new Error('SIMULATION_MANIFEST_CORRUPT');
    const temporary = path.join(this.root, '.head-' + randomUUID());
    await writeFile(temporary, id, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(this.root, 'HEAD'));
    return manifest;
  }
  async load() {
    await this.assertRoot();
    const id = await readFile(path.join(this.root, 'HEAD'), 'utf8');
    if (!validHash(id)) throw new Error('INVALID_SIMULATION_HEAD');
    const bytes = await readFile(path.join(this.root, 'commits', id + '.json'));
    if (hash(bytes) !== id) throw new Error('SIMULATION_MANIFEST_CORRUPT');
    const manifest = JSON.parse(bytes);
    const campaign = JSON.parse(await this.readBlob(manifest.checkpoint));
    if (!campaign.simulation_only || campaign.version !== 'firm-simulation/1') throw new Error('NOT_A_SIMULATION_CHECKPOINT');
    for (const file of manifest.files) await this.readBlob(file.sha256);
    return { campaign, manifest };
  }
  async readBlob(digest) {
    if (!validHash(digest)) throw new Error('INVALID_SIMULATION_DIGEST');
    const bytes = await readFile(path.join(this.root, 'blobs', digest));
    if (hash(bytes) !== digest) throw new Error('SIMULATION_BLOB_CORRUPT');
    return bytes;
  }
  async run({ limit = 1, untilMonth = 24, pause = false } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(untilMonth) || untilMonth < 0 || untilMonth > 24) throw new Error('INVALID_RUN_LIMIT');
    return this.exclusive(async () => {
      let { campaign: c } = await this.load();
      if (pause) { c.status = 'paused'; await this.commit(c); return c; }
      if (c.status === 'completed') return c;
      startFirm(c);
      for (let i = 0; i < limit && c.status === 'running'; i++) {
        if (c.month >= untilMonth) { c.status = 'paused'; break; }
        if (c.disk_run.actions >= c.disk_run.max_actions) { c.status = 'paused'; c.blocker = 'SIMULATION_ACTION_BUDGET_REACHED'; break; }
        // advance() may cross idle months; stop before the requested boundary.
        const pending = c.missions.filter(m => m.state !== 'completed');
        const nextMonth = pending.length ? Math.max(c.month, Math.min(...pending.map(m => m.start_month))) : 24;
        if (nextMonth >= untilMonth && untilMonth < 24) { c.month = untilMonth; c.status = 'paused'; break; }
        const done = advance(c, { limit: 1 });
        c.disk_run.actions += done;
        // Save each event. A restart reads HEAD, not a partially written checkpoint.
        await this.commit(c);
      }
      if (c.status === 'running') c.status = 'paused';
      await this.commit(c);
      return c;
    });
  }
}
