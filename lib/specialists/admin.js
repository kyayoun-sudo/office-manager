import { registry, saveSpecialist, setPermission, decideCall } from './specialistService.js';
import { specialistRouter } from './specialistRouter.js';

export async function specialistsAdmin(orgId, input, actor, d = {}) {
  if (!['owner','partner','it_admin'].includes(actor?.role)) throw Object.assign(new Error('SPECIALIST_ADMIN_REQUIRED'),{statusCode:403});
  if (input.action === 'save') return saveSpecialist(orgId,input,actor,d);
  if (input.action === 'permission') return setPermission(orgId,input,actor,d);
  if (input.action === 'decide') return decideCall(orgId,input,actor,d);
  if (input.action === 'test') {
    // Admin test always uses Shadow + fixed harmless input; no mission data and no impersonation.
    return specialistRouter({orgId,agentKey:'shadow',actor},d).call({specialist_key:input.specialist_key,capability:'mock.echo',input:{message:'Registry smoke test'},call_id:input.call_id});
  }
  if (input.action && input.action !== 'list') throw Object.assign(new Error('SPECIALIST_ACTION_INVALID'),{statusCode:400});
  return registry(orgId,actor,d);
}
