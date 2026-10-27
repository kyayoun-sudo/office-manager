import { ALL_PROVIDERS } from './ai-providers.js';
import { trackedProviderCall } from './ai-pool.js';
import { callModel } from './ai-plus.js';
export async function checkProvider(provider, d = {}) {
  if (!ALL_PROVIDERS.includes(provider)) throw Object.assign(new Error('UNKNOWN_AI_PROVIDER'), {statusCode:400});
  try {
    const r = await trackedProviderCall(provider, () => (d.callModel || callModel)({provider, instructions:'Test technique avec données fictives. Réponds simplement OK.',input:'Bonjour. Test de connexion uniquement.',maxTokens:512}, d), { ...d, probe: true });
    return {provider,ok:true,model:r.model,scope:'synthetic_connection_test'};
  } catch(e) { return {provider,ok:false,error:/^[A-Z0-9_]+$/.test(e.message)?e.message:'PROVIDER_CONNECTION_FAILED',scope:'synthetic_connection_test'}; }
}
