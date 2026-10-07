import test from "node:test";
import assert from "node:assert/strict";
import { loadMemory, memoryFolderId } from "../lib/memory-runtime.js";
import { runMappingPass, MEMORY_FILE_NAMES } from "../lib/orpailleur-memory.js";
import { FOLDER_MIME } from "../lib/mission-engine.js";
test("migrated memory is found by ID in configured folder; absent files never reset it", async () => {
  const keys=["OFFICE_MANAGER_MEMORY_FOLDER_ID","OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const files=new Map(), buffers=new Map(); let serial=0,writes=0;
  const drive={
    findFilesByExactName:async(name,parent)=>[...files.values()].filter(f=>f.name===name&&f.parents.includes(parent)),
    downloadBuffer:async id=>buffers.get(id),
    listChildren:async id=>id==="root"?[{id:"reference",name:"Reference",mimeType:FOLDER_MIME,parents:["root"]}]:[],
    createBinary:async({name,parentId,buffer})=>{writes++;const f={id:"memory-"+(++serial),name,parents:[parentId]};files.set(f.id,f);buffers.set(f.id,buffer);return f;},
    updateBinary:async(id,{buffer})=>{writes++;buffers.set(id,buffer);return files.get(id);}
  };
  try {
    delete process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID;
    delete process.env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY;
    await runMappingPass(drive,{rootFolderId:"root",memoryFolderId:"root",maxReads:0});
    const ids=[...files.keys()];
    for(const f of files.values())f.parents=["manager"];
    Object.assign(process.env,{OFFICE_MANAGER_MEMORY_FOLDER_ID:"manager",OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY:"true"});
    assert.equal(memoryFolderId(),"manager");
    const memory=await loadMemory(drive);
    assert.equal(memory.map.fileId,ids[0]);assert.equal(memory.register.fileId,ids[1]);
    assert.equal(writes,2,"read-only reopen creates no duplicates");
    const register=[...files.values()].find(f=>f.name===MEMORY_FILE_NAMES.register);
    files.delete(register.id);
    await assert.rejects(loadMemory(drive),/EXISTING_MEMORY_REQUIRED/);
    process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID="wrong";
    await assert.rejects(loadMemory(drive),/EXISTING_MEMORY_REQUIRED/);
    delete process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID;
    await assert.rejects(loadMemory(drive),/MEMORY_FOLDER_NOT_CONFIGURED/);
    assert.equal(writes,2);
  } finally {keys.forEach(k=>saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k]);}
});
