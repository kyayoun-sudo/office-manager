import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('async function readApiResponse(');
// End of the function itself (code was later added between it and 'runs-read').
const close = page.slice(start).search(/\r?\n\}\r?\n/);
const end = start + close + page.slice(start + close).indexOf('}') + 1;
const readResponse = vm.runInNewContext('(' + page.slice(start, end).trim() + ')');

test('server timeout text becomes a clear message, without echoing server details', async () => {
  await assert.rejects(readResponse(new Response('An error occurred FUNCTION_INVOCATION_TIMEOUT', { status: 504 })),
    /Vérifie son état avant de relancer une action/);
});

test('valid API answers and authorization errors remain supported', async () => {
  const data = await readResponse(new Response('{"answer":"Synthetic answer"}'));
  assert.equal(data.answer, 'Synthetic answer');
  await assert.rejects(readResponse(new Response('{"error":"UNAUTHORIZED"}', { status: 401 })), /UNAUTHORIZED/);
});

test('unexpected HTML never produces a JSON parser error or leaks the response', async () => {
  await assert.rejects(readResponse(new Response('<html>private runtime details</html>', { status: 500 })),
    /réponse illisible/);
});
