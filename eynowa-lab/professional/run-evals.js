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

async function main() {
  const live = process.argv.includes('--live');
  const results = [];

  for (const testCase of EVALUATION_CASES) {
    try {
      const result = live ? await runLive(testCase.input) : buildProfessionalRequest(testCase.input);
      const domains = result.domains || [];
      const topics = result.topics || [];
      const domainPass = includesAll(domains, testCase.expected_domains);
      const topicPass = includesAll(topics, testCase.expected_topics);
      const livePass = !live || (Number(result.knowledge_hits || 0) > 0 && typeof result.answer === 'string');
      results.push({ id: testCase.id, pass: domainPass && topicPass && livePass, domains, topics, knowledge_hits: result.knowledge_hits ?? null });
    } catch (error) {
      results.push({ id: testCase.id, pass: false, error: String(error?.message || error) });
    }
  }

  const passed = results.filter((row) => row.pass).length;
  const failed = results.filter((row) => !row.pass);
  const summary = {
    mode: live ? 'live' : 'offline-routing',
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
