import {createHash} from 'node:crypto';
import type {PluginData,PluginJobs,PluginDocument} from '@webdock/plugin-sdk/contracts';
type Context={data:PluginData;jobs:PluginJobs};
type Note={id:string;title:string;body:string;updatedAt:string;reminderAt:string|null;reminderVersion:string;reminderState:'pending'|'scheduled'|'due'|null;lastRequestID:string;lastRequestHash:string};
type Notes={notes:Note[]};
const key='notes';
const requestID=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9_.-]{8,128}$/.test(x);
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
async function load(ctx:Context){const doc=await ctx.data.read(key);const notes=doc.value===null?[]:(doc.value as Notes).notes;if(!Array.isArray(notes)||notes.length>100)throw Error('Invalid stored notes');return {notes,revision:doc.revision};}
async function store(ctx:Context,notes:Note[],revision:string|null,id:string){if(Buffer.byteLength(JSON.stringify({notes}))>24*1024)throw Error('Project notes storage limit reached');return ctx.data.write({key,value:{notes},expectedRevision:revision,idempotencyKey:id});}
async function schedule(ctx:Context,note:Note){
 if(!note.reminderAt)return;
 return ctx.jobs.enqueue({name:'notes.remind',payload:{id:note.id,version:note.reminderVersion},runAt:note.reminderAt,idempotencyKey:'reminder-'+note.id+'-'+note.reminderVersion});
}
export async function notesAction(name:string,input:any,ctx:Context){
 const doc=await load(ctx);
 if(name==='notes.list')return doc;
 if(!input||!uuid(input.id)||!requestID(input.requestID))throw Error('Invalid note request');
 const previous=doc.notes.find(n=>n.id===input.id);
 if(name==='notes.delete'){
  if(!previous)return doc;
  if(input.expectedRevision!==doc.revision)throw Error('Notes changed; reload before saving');
  const saved=await store(ctx,doc.notes.filter(n=>n.id!==input.id),doc.revision,input.requestID);return {notes:(saved.value as Notes).notes,revision:saved.revision};
 }
 if(name!=='notes.save')throw Error('Unknown action');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>100||typeof input.body!=='string'||input.body.length>5000)throw Error('Use a title (100 characters) and note (5000 characters maximum)');
 if(input.reminderAt!==null&&(typeof input.reminderAt!=='string'||!Number.isFinite(Date.parse(input.reminderAt))||Date.parse(input.reminderAt)>Date.now()+604800000))throw Error('Reminder must be within seven days');
 const fingerprint=createHash('sha256').update(JSON.stringify([input.id,input.title,input.body,input.reminderAt,input.expectedRevision])).digest('hex');
 if(previous&&previous.lastRequestID===input.requestID){if(previous.lastRequestHash!==fingerprint)throw Error('Request key reused with changed input');await schedule(ctx,previous).catch(()=>{});return doc;}
 if(input.expectedRevision!==doc.revision)throw Error('Notes changed; reload before saving');
 if(!previous&&doc.notes.length>=100)throw Error('Maximum 100 notes per project');
 const note:Note={id:input.id,title:input.title.trim(),body:input.body,updatedAt:new Date().toISOString(),reminderAt:input.reminderAt,reminderVersion:input.requestID,reminderState:input.reminderAt?'pending':null,lastRequestID:input.requestID,lastRequestHash:fingerprint};
 const notes=previous?doc.notes.map(n=>n.id===note.id?note:n):[note,...doc.notes];
 const saved=await store(ctx,notes,doc.revision,input.requestID);
 // The persisted pending state is the outbox. The declared reconcile job retries after an enqueue outage.
 await schedule(ctx,note).catch(()=>{});
 return {notes:(saved.value as Notes).notes,revision:saved.revision};
}
export async function notesJob(name:string,payload:any,ctx:Context){
 for(let attempt=0;attempt<4;attempt++){
  const doc=await load(ctx);
  if(name==='notes.reconcile'){
   let notes=doc.notes,changed=false;
   for(const note of doc.notes){if(note.reminderAt&&note.reminderState!=='due'&&Date.parse(note.reminderAt)<=Date.now()){notes=notes.map(n=>n.id===note.id?{...n,reminderState:'due' as const}:n);changed=true;}else if(note.reminderState==='pending'){await schedule(ctx,note);notes=notes.map(n=>n.id===note.id?{...n,reminderState:'scheduled' as const}:n);changed=true;}}
   if(!changed)return {changed:false};
   try{await store(ctx,notes,doc.revision,'reconcile-'+doc.revision);return {changed:true};}catch(e){if((e as any).code==='conflict')continue;throw e;}
  }
  if(name!=='notes.remind'||!payload||!uuid(payload.id)||!requestID(payload.version))throw Error('Unknown job');
  const note=doc.notes.find(n=>n.id===payload.id&&n.reminderVersion===payload.version);
  if(!note||!note.reminderAt||note.reminderState==='due')return {changed:false};
  if(Date.parse(note.reminderAt)>Date.now())throw Error('Reminder not due');
  try{await store(ctx,doc.notes.map(n=>n.id===note.id?{...n,reminderState:'due' as const}:n),doc.revision,'due-'+note.id+'-'+note.reminderVersion);return {changed:true};}catch(e){if((e as any).code==='conflict')continue;throw e;}
 }
 throw Error('Notes changed repeatedly; retry reminder');
}
