import test from "node:test";
import assert from "node:assert/strict";
import { listDriveChildren, listDriveChildrenPage } from "../lib/google-drive.js";
test("bridge listing refuses ambiguous cap and incomplete replies", async () => {
  const keys=["GOOGLE_SERVICE_ACCOUNT_JSON","GOOGLE_OAUTH_REFRESH_TOKEN","GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ORPAILLEUR_JOB_SECRET"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])), original=globalThis.fetch;
  try {
    keys.forEach(k=>delete process.env[k]);
    Object.assign(process.env,{SUPABASE_URL:"https://synthetic.invalid",SUPABASE_SERVICE_ROLE_KEY:"test",ORPAILLEUR_JOB_SECRET:"test"});
    let response={files:[{id:"A"}]};
    globalThis.fetch=async (url,init)=>{assert.equal(JSON.parse(init.body).action,"list_children");return Response.json(response);};
    assert.deepEqual(await listDriveChildren("folder"),[{id:"A"}]);
    for(const partial of [{files:[{id:"A"}],nextPageToken:"next"},{files:[],incompleteSearch:true},{files:Array.from({length:1000},(_,i)=>({id:String(i)}))}]) {
      response=partial; await assert.rejects(listDriveChildren("folder"),/DRIVE_LISTING_INCOMPLETE/);
    }
  } finally {
    globalThis.fetch=original;
    keys.forEach(k=>saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k]);
  }
});

test('direct Google listing exposes one page and preserves the caller cursor', async () => {
  const keys = ['GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'OFFICE_MANAGER_ALLOW_ENV_DRIVE', 'TATY_SHARED_DRIVE_ID'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const original = globalThis.fetch; const urls = [];
  try {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    Object.assign(process.env, { GOOGLE_OAUTH_REFRESH_TOKEN: 'synthetic', GOOGLE_OAUTH_CLIENT_ID: 'synthetic', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic', OFFICE_MANAGER_ALLOW_ENV_DRIVE: 'true', TATY_SHARED_DRIVE_ID: 'synthetic-drive' });
    globalThis.fetch = async url => {
      if (String(url).includes('/token')) return Response.json({ access_token: 'synthetic' });
      const u = new URL(url); urls.push(u);
      return Response.json(u.searchParams.get('pageToken') === 'P2' ? { files: [{ id: 'B' }] } : { files: [{ id: 'A' }], nextPageToken: 'P2' });
    };
    assert.deepEqual(await listDriveChildrenPage('folder'), { files: [{ id: 'A' }], nextPageToken: 'P2' });
    assert.equal(urls.length, 1);
    assert.deepEqual(await listDriveChildrenPage('folder', { pageToken: 'P2' }), { files: [{ id: 'B' }], nextPageToken: null });
    assert.equal(urls[1].searchParams.get('pageToken'), 'P2');
    assert.match(urls[1].searchParams.get('fields'), /shortcutDetails/);
    assert.deepEqual(await listDriveChildren('folder'), [{ id: 'A' }, { id: 'B' }]);
  } finally {
    globalThis.fetch = original;
    keys.forEach(k => saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]);
  }
});
