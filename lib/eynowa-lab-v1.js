// EYNOWA Lab contract v1 client (2026-11-21): ONE call, the memory write of knowledge a person has validated.
// Independent of the old direct gateway client (eynowa-lab-client.js, legacy key): its own key EYNOWA_LAB_V1_KEY (an application key
// declared in the Lab's clients file, stored there as a SHA-256 only), its own route. The Lab refuses a write without a human validation
// and without a tenant declared for this key; the result counts only with `stored: true` and a memory id.
const clean = v => String(v || '').trim().replace(/\/+$/, '');

export const labV1Configured = (env = process.env) => Boolean(clean(env.EYNOWA_LAB_URL) && String(env.EYNOWA_LAB_V1_KEY || '').trim());

const fail = (code, extra = {}) => Object.assign(new Error(code), extra);

export async function labRemember({ tenant, text, validatedBy, validatedAt, idempotencyKey, kind = 'validated_practice', metadata = {} }, d = {}) {
  const env = d.env || process.env;
  if (!labV1Configured(env)) throw fail('EYNOWA_LAB_V1_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), d.timeoutMs || 45000);
  try {
    const response = await (d.fetchImpl || fetch)(clean(env.EYNOWA_LAB_URL) + '/v1/memory/remember', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + String(env.EYNOWA_LAB_V1_KEY).trim(), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, scope: { tenant }, validation: { validated_by: validatedBy, validated_at: validatedAt }, idempotency_key: idempotencyKey, kind, metadata })
    });
    let data = null; try { data = JSON.parse(await response.text()); } catch { /* not json */ }
    if (!response.ok) throw fail(String(data?.error || 'EYNOWA_LAB_HTTP_' + response.status), { status: response.status });
    // Nothing is claimed without the Lab's own confirmation.
    if (data?.stored !== true || !data?.memory_id) throw fail('EYNOWA_LAB_NOT_STORED');
    return { stored: true, memory_id: String(data.memory_id), tenant: data.tenant || tenant };
  } catch (e) {
    if (controller.signal.aborted) throw fail('EYNOWA_LAB_TIMEOUT');
    throw e;
  } finally { clearTimeout(timer); }
}
