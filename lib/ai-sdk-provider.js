import { dispatchPool } from './ai-pool.js';
import { OpenAIProvider } from '@openai/agents';
import { COMPATIBLE_PROVIDERS, providerConfig, providerOrder } from './ai-providers.js';
import { OPENAI_DEFAULT_MODEL } from './ai-providers.js';

const sdkCompatible = provider => provider === 'openai' || provider === 'openrouter' || Boolean(COMPATIBLE_PROVIDERS[provider]);

// Per-run SDK provider. No global client/key replacement, and no replay of a run's tools.
// Every operational agent uses the same central providerOrder; only providers that can
// execute OpenAI-compatible function tools are retained for the Agents SDK turn.
export function sdkProviderConfig(requested = 'auto', env = process.env, random = Math.random, d = {}) {
  if (requested === 'auto') {
    const choices = providerOrder(null, env, random, { tools: true }).filter(sdkCompatible);
    const models = new Map();
    let selected = null;
    const providersUsed = [];
    const modelFor = async provider => {
      if (!models.has(provider)) {
        const cfg = sdkProviderConfig(provider, env, random);
        const model = d.getModel ? await d.getModel(provider, cfg) : cfg.modelProvider ? await cfg.modelProvider.getModel(cfg.model) : await new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }).getModel(cfg.model);
        models.set(provider, model);
      }
      return models.get(provider);
    };
    const infer = async request => {
      // A server-owned conversation cannot be sent to another provider without its full history.
      const candidates = request.previousResponseId || request.conversationId ? [selected || choices[0]].filter(Boolean) : choices;
      const winner = await dispatchPool(candidates, async (provider, signal) => {
        const model = await modelFor(provider);
        // The pool owns retries. This installed SDK flag disables transport retries of an exhausted account.
        const result = await model.getResponse({ ...request, _internal: { ...request._internal, runnerManagedRetry: true }, signal: request.signal ? AbortSignal.any([request.signal, signal]) : signal,
          ...(provider === 'openai' ? {} : { tools: request.tools.map(t => t.type === 'function' ? { ...t, strict: false } : t) }) });
        return { provider, response: result };
      }, { ...d, env, signal: request.signal });
      selected = winner.provider; providersUsed.push(selected); return winner.response;
    };
    const model = { getResponse: infer, async *getStreamedResponse(request) {
      // Buffer ONE inference before exposing its output. A failed stream cannot leak half a tool call.
      const response = await infer(request);
      yield { type: 'response_done', response: { id: response.responseId || 'pool-response', usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens }, output: response.output } };
    } };
    return { provider: 'pool', getProviderUsage: () => [...providersUsed], model: 'available-ai', modelProvider: { getModel: async () => model }, modelSettings: { parallelToolCalls: false }, tracingDisabled: true };
  }
  const choices = providerOrder(['openai'], env, random, { tools: true }).filter(sdkCompatible);
  const provider = requested === 'dual' ? 'openai'
    : requested === 'auto' ? choices[0] || 'openai'
      : requested;

  if (provider === 'ollama') throw Error('OLLAMA_OPERATIONAL_TOOLS_UNSUPPORTED');
  if (provider === 'eynowa-lab') throw Error('EYNOWA_LAB_OPERATIONAL_TOOLS_UNSUPPORTED');
  if (!sdkCompatible(provider)) throw Error(provider.toUpperCase() + '_OPERATIONAL_TOOLS_UNSUPPORTED');

  if (provider === 'openai') return { provider, model: env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL };

  const cfg = provider === 'openrouter'
    ? { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || 'openrouter/auto', baseURL: 'https://openrouter.ai/api/v1' }
    : providerConfig(provider, env);
  if (!cfg?.apiKey) throw new Error(provider.toUpperCase() + '_NOT_CONFIGURED');

  const transport = new OpenAIProvider({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, useResponses: false });
  const modelProvider = { async getModel() {
    // Existing agent definitions carry an OpenAI model name. Bind every delegated
    // agent in this run to the selected provider's own configured model.
    const model = await transport.getModel(cfg.model);
    const compatible = request => ({
      ...request,
      tools: request.tools.map(t => t.type === 'function' ? { ...t, strict: false } : t)
    });
    // Providers do not all implement OpenAI's strict JSON-schema dialect. Actual tool
    // arguments are still parsed/validated by the original SDK tools on the server.
    return {
      getResponse: request => model.getResponse(compatible(request)),
      getStreamedResponse: request => model.getStreamedResponse(compatible(request))
    };
  } };

  return {
    provider,
    model: cfg.model,
    modelProvider,
    modelSettings: { parallelToolCalls: false },
    tracingDisabled: true
  };
}
