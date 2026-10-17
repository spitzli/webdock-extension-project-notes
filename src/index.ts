import {createServer} from 'node:http';import {timingSafeEqual} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {createPluginContext} from '@webdock/plugin-sdk/server';import {notesAction,notesJob} from './notes.js';
const secret=process.env.WEBDOCK_PLUGIN_RUNTIME_TOKEN,host=process.env.WEBDOCK_PLUGIN_HOST_URL;
if(!secret||secret.length<32||!host)throw Error('Host URL and runtime token required');
const server=createServer(async(req,res)=>{
 if(req.method==='GET'&&['/healthz','/readyz'].includes(req.url??'')){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
 if(req.method==='GET'&&req.url?.split('?')[0]==='/ui/notes'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'");res.end(await readFile(new URL('../ui/notes.html',import.meta.url)));return;
 }
 res.setHeader('Content-Type','application/json');
 const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+secret);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401);res.end('{"error":"Unauthorized"}');return;}
 try{
  const token=req.headers['x-plugin-invocation'];if(typeof token!=='string')throw Error('Missing invocation');
  const ctx=createPluginContext({hostURL:host!,token:()=>token});let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32*1024)throw Error('Request too large');chunks.push(chunk);}
  if(req.method!=='POST')throw Error('Unsupported method');const body=JSON.parse(Buffer.concat(chunks).toString());
  const result=req.url==='/webdock/actions'?await notesAction(body.name,body.input,ctx):req.url==='/webdock/jobs'?await notesJob(body.name,body.payload,ctx):null;
  if(result===null){res.writeHead(404);res.end('{"error":"Not found"}');return;}
  res.end(JSON.stringify(result));
 }catch(e){res.writeHead((e as any).code==='conflict'?409:400);res.end(JSON.stringify({error:(e as Error).message}));}
});
server.listen(Number(process.env.PORT??8080),process.env.HOST??'127.0.0.1',()=>console.log(JSON.stringify({port:(server.address() as {port:number}).port})));
process.on('SIGTERM',()=>server.close());
