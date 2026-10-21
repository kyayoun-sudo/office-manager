import { AsyncLocalStorage } from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const operationActor=()=>context.getStore() || null;
export function withOperationActor(value,run) {
  const parent=operationActor();
  const next={orgId:value.orgId,actor:String(value.actor || '').slice(0,120),kind:['human','agent','system'].includes(value.kind)?value.kind:'system',
    initiated_by:parent?.orgId===value.orgId?(parent.kind==='human'?parent.actor:parent.initiated_by):null};
  return context.run(next,run);
}
