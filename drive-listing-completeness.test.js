import test from "node:test";
import assert from "node:assert/strict";
import { listDriveChildren } from "../lib/google-drive.js";
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
