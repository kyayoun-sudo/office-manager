import { OpenAIProvider } from '@openai/agents';
import { COMPATIBLE_PROVIDERS, providerConfig, providerOrder } from './ai-providers.js';

const sdkCompatible = provider => provider === 'openai' || provider === 'openrouter' || Boolean(COMPATIBLE_PROVIDERS[provider]);

// Per-run SDK provider. No global client/key replacement, and no replay of a run's tools.
// Every operational agent uses the same central providerOrder; only providers that can
// execute OpenAI-compatible function tools are retained for the Agents SDK turn.
export function sdkProviderConfig(requested = 'auto', env = process.env, random = Math.random) {
  const choices = providerOrder(['openai'], env, random, { tools: true }).filter(sdkCompatible);
  const provider = requested === 'dual' ? 'openai'
    : requested === 'auto' ? choices[0] || 'openai'
      : requested;

  if (provider === 'ollama') throw Error('OLLAMA_OPERATIONAL_TOOLS_UNSUPPORTED');
  if (provider === 'eynowa-lab') throw Error('EYNOWA_LAB_OPERATIONAL_TOOLS_UNSUPPORTED');
  if (!sdkCompatible(provider)) throw Error(provider.toUpperCase() + '_OPERATIONAL_TOOLS_UNSUPPORTED');

  if (provider === 'openai') return { provider, model: env.OPENAI_MODEL || 'gpt-5.6-luna' };

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
