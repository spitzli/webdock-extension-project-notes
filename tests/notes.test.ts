import test from 'node:test';import assert from 'node:assert/strict';
import {notesAction,notesJob} from '../src/notes.js';
test('notes use revisions, isolate reminders from edits/deletion, and retry scheduling',async()=>{
 let value:any=null,revision:string|null=null;const queued:any[]=[];let fail=false;
 const ctx:any={data:{read:async()=>({value:structuredClone(value),revision}),write:async(x:any)=>{assert.equal(x.expectedRevision,revision);value=structuredClone(x.value);revision=String(Number(revision??0)+1);return {value:structuredClone(value),revision};}},jobs:{enqueue:async(x:any)=>{if(fail)throw Error('offline');queued.push(x);return {id:'job-test'};}}};
 const id='11111111-1111-4111-8111-111111111111';
 const input={id,title:'Deploy',body:'Check logs',reminderAt:new Date(Date.now()+1000).toISOString(),expectedRevision:null,requestID:'request-0001'};
 fail=true;await notesAction('notes.save',input,ctx);assert.equal(value.notes[0].reminderState,'pending');
 fail=false;await notesJob('notes.reconcile',{},ctx);assert.equal(queued.length,1);
 await assert.rejects(()=>notesAction('notes.save',{...input,title:'stale',requestID:'request-0002'},ctx),/changed/);
 await notesAction('notes.save',{...input,title:'New',reminderAt:null,expectedRevision:revision,requestID:'request-0003'},ctx);
 await notesJob('notes.remind',queued[0].payload,ctx);assert.equal(value.notes[0].reminderState,null);
 await notesAction('notes.delete',{id,expectedRevision:revision,requestID:'request-0004'},ctx);
 await notesJob('notes.remind',queued[0].payload,ctx);assert.equal(value.notes.length,0);
});
test('reconcile repairs an overdue scheduled reminder after delivery retries were exhausted',async()=>{
 let value:any={notes:[{id:'11111111-1111-4111-8111-111111111111',title:'missed',body:'',updatedAt:new Date().toISOString(),reminderAt:new Date(Date.now()-1000).toISOString(),reminderVersion:'reminder-v1',reminderState:'scheduled'}]},revision='1';
 const ctx:any={data:{read:async()=>({value:structuredClone(value),revision}),write:async(x:any)=>{value=x.value;revision='2';return{value,revision}}},jobs:{enqueue:async()=>{throw Error('A retained failed job cannot be re-added')}}};
 await notesJob('notes.reconcile',{},ctx);assert.equal(value.notes[0].reminderState,'due');
});
