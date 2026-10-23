import { EVALUATION_CASES } from './evaluation-cases.js';
import { buildProfessionalRequest } from './router.js';

function includesAll(actual = [], expected = []) {
  const set = new Set(actual);
  return expected.every((item) => set.has(item));
}

function gatewayUrl() {
  return String(process.env.EYNOWA_LAB_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

async function runLive(input) {
  const key = process.env.EYNOWA_LAB_API_KEY;
  if (!key) throw new Error('EYNOWA_LAB_API_KEY_MISSING_FOR_LIVE_EVAL');
  const response = await fetch(`${gatewayUrl()}/v1/professional/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `LIVE_EVAL_HTTP_${response.status}`);
  return body;
}

function progress(index, total, row, elapsedMs) {
  const status = row.pass ? 'PASS' : 'FAIL';
  const details = row.error
    ? `error=${row.error}`
    : `topics=${(row.topics || []).join(',')} knowledge_hits=${row.knowledge_hits ?? 'n/a'}`;
  console.error(`[${index}/${total}] ${status} ${row.id} ${elapsedMs}ms ${details}`);
}

function selectedCases() {
  const requestedIds = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!requestedIds.length) return EVALUATION_CASES;

  const wanted = new Set(requestedIds);
  const selected = EVALUATION_CASES.filter((testCase) => wanted.has(testCase.id));
  const missing = requestedIds.filter((id) => !selected.some((testCase) => testCase.id === id));
  if (missing.length) throw new Error(`UNKNOWN_EVAL_CASES: ${missing.join(', ')}`);
  return selected;
}

async function main() {
  const live = process.argv.includes('--live');
  const cases = selectedCases();
  const results = [];
  const totalCases = cases.length;

  for (let index = 0; index < totalCases; index += 1) {
    const testCase = cases[index];
    const started = Date.now();
    let row;

    try {
      const result = live ? await runLive(testCase.input) : buildProfessionalRequest(testCase.input);
      const domains = result.domains || [];
      const topics = result.topics || [];
      const domainPass = includesAll(domains, testCase.expected_domains);
      const topicPass = includesAll(topics, testCase.expected_topics);
      const livePass = !live || (Number(result.knowledge_hits || 0) > 0 && typeof result.answer === 'string');
      row = {
        id: testCase.id,
        pass: domainPass && topicPass && livePass,
        domains,
        topics,
        knowledge_hits: result.knowledge_hits ?? null,
      };
    } catch (error) {
      row = { id: testCase.id, pass: false, error: String(error?.message || error) };
    }

    results.push(row);
    progress(index + 1, totalCases, row, Date.now() - started);
  }

  const passed = results.filter((row) => row.pass).length;
  const failed = results.filter((row) => !row.pass);
  const summary = {
    mode: live ? 'live' : 'offline-routing',
    selected_case_ids: cases.length === EVALUATION_CASES.length ? 'all' : cases.map((row) => row.id),
    total: results.length,
    passed,
    failed: failed.length,
    pass_rate: results.length ? passed / results.length : 0,
    failures: failed,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
