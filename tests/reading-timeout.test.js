import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parseReadingJson} from '../lib/reading-ai-budget.js';

test('a stalled reading request stops with a resumable timeout and cleans its progress timer',async()=>{
  const timers=new Map();let id=0,aborted=false,seconds;
  const window={OfficeManager:{}};
  vm.runInNewContext(await readFile(new URL('../assets/procedure-reading.js',import.meta.url),'utf8'),{
    window,AbortController,Promise,Error,Date,
    setInterval:fn=>{timers.set(++id,fn);return id;},clearInterval:i=>timers.delete(i),
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i)
  });
  const request=window.OfficeManager.readingRequest(signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('AbortError'));})),s=>{seconds=s;});
  await Promise.resolve();timers.get(1)();assert.equal(typeof seconds,'number');
  timers.get(2)();await assert.rejects(request,/READING_REQUEST_TIMEOUT/);
  assert.equal(aborted,true);assert.equal(timers.size,0);
});

test('a cut-off AI response cannot be repaired into a complete reading',()=>{
  assert.throws(()=>parseReadingJson('{"analysis_complete":true,"findings":[{"fact":"ok"},{"fact":"cut'));
  assert.equal(parseReadingJson('```json\n{"analysis_complete":true}\n```').analysis_complete,true);
});
