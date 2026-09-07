import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { migrate } from '../deploy/local/migrate.mjs';
import { passwordHash, sha, guard } from '../lib/access';
import * as auth from '../app/api/auth/route';
import * as access from '../app/api/access/route';
import * as app from '../app/api/app/route';
import * as workflow from '../app/api/workflow/route';
import * as pdf from '../app/api/document/pdf/route';
import * as docx from '../app/api/document/docx/route';
import * as original from '../app/api/document/import/route';
import * as formPDF from '../app/api/pdf/route';
import JSZip from 'jszip';

// Reproduce the pre-0.5 runtime-created tables/columns, including a real legacy record.
const legacy=new DatabaseSync(':memory:');legacy.exec(readFileSync(new URL('../drizzle/0000_woozy_inhumans.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
for(const statement of readFileSync(new URL('../drizzle/0001_polite_nico_minoru.sql',import.meta.url),'utf8').split('--> statement-breakpoint')){if(/CREATE TABLE `document_import|ALTER TABLE `templates`/.test(statement))legacy.exec(statement);}
legacy.prepare("INSERT INTO templates(id,name,code,version,category,field_schema,document_meta,numbering_pattern,status,created_by,created_at,updated_at) VALUES('legacy-doc','Retained policy','CCPL-LEGACY',1,'Quality','[]','{\"outputStyle\":\"controlled-document\",\"documentStatus\":\"APPROVED\"}','','Active','Legacy author','2026-01-01','2026-01-01')").run();
migrate(legacy);migrate(legacy);assert.equal(legacy.prepare("SELECT name FROM templates WHERE id='legacy-doc'").get()!.name,'Retained policy');assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM ac_users').get()!.n,0);legacy.close();
console.log('PASS: populated legacy schema migrates without deleting records or creating a default account');
const database=new DatabaseSync(':memory:');migrate(database);migrate(database);
class Statement {
 values:unknown[]=[];
 constructor(public sql:string){}
 bind(...values:unknown[]){this.values=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;}
 async first(){return database.prepare(this.sql).get(...this.values as never[])||null;}
 async all(){return {success:true,results:database.prepare(this.sql).all(...this.values as never[]),meta:{changes:0}};}
 async run(){const r=database.prepare(this.sql).run(...this.values as never[]);return {success:true,results:[],meta:{changes:r.changes}};}
}
const adapter={prepare:(sql:string)=>new Statement(sql),async batch(statements:Statement[]){database.exec('BEGIN IMMEDIATE');try{const result=[];for(const statement of statements)result.push(await statement.run());database.exec('COMMIT');return result;}catch(e){database.exec('ROLLBACK');throw e;}}};
(globalThis as unknown as {__FORMFLOW_DB__:unknown}).__FORMFLOW_DB__=adapter;
const initialPassword=randomBytes(24).toString('hex');
database.prepare("INSERT INTO ac_users(id,username,name,roles,password,created_at) VALUES('super-admin','superadmin','Test administrator','[\"super_admin\"]',?,?)").run(passwordHash(initialPassword),new Date().toISOString());
type Endpoint={GET?:(r:Request)=>Promise<Response|undefined>;POST?:(r:Request)=>Promise<Response|undefined>};
async function call(endpoint:Endpoint,cookie='',body?:unknown,query='',expected=200){const req=new Request('http://formflow.test'+query,{method:body?'POST':'GET',headers:{origin:'http://formflow.test',cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const res=await (body?endpoint.POST!:endpoint.GET!)(req);assert(res);if(res.status!==expected)throw Error(`Expected ${expected}, got ${res.status}: ${await res.text()}`);return res;}
async function login(username:string,password:string){const r=await call(auth,'',{action:'login',username,password});return r.headers.get('set-cookie')!.split(';')[0];}
let superCookie=await login('superadmin',initialPassword);
await call(app,superCookie,undefined,'',428);
const superPassword=randomBytes(24).toString('hex');await call(auth,superCookie,{action:'password',currentPassword:initialPassword,password:superPassword});await call(auth,superCookie,undefined,'',401);superCookie=await login('superadmin',superPassword);
async function addUser(username:string,roles:string[]){const password=randomBytes(24).toString('hex');await call(access,superCookie,{action:'create',username,name:username,roles,password});let cookie=await login(username,password);const newPassword=randomBytes(24).toString('hex');await call(auth,cookie,{action:'password',currentPassword:password,password:newPassword});cookie=await login(username,newPassword);return {cookie,id:String(database.prepare('SELECT id FROM ac_users WHERE username=?').get(username)!.id),password:newPassword};}
const writer=await addUser('writer',['author']),reviewer=await addUser('reviewer',['reviewer']),director=await addUser('director',['approver']),auditor=await addUser('auditor',['auditor']),stranger=await addUser('stranger',['author']),manager=await addUser('manager',['admin']);
console.log('PASS: password rotation, login and session revocation');
await call(access,writer.cookie,{action:'create',username:'intruder',name:'Intruder',roles:['admin'],password:superPassword},'',403);
await call(access,manager.cookie,{action:'create',username:'intruder',name:'Intruder',roles:['admin'],password:superPassword},'',403);
await call(access,superCookie,{action:'create',username:'second-super',name:'Second super',roles:['super_admin'],password:superPassword},'',400);
assert.throws(()=>database.prepare("UPDATE ac_users SET active=0 WHERE id='super-admin'").run());
assert.throws(()=>database.prepare("DELETE FROM ac_users WHERE id='super-admin'").run());
const create={action:'create-template',name:'Test policy',code:'CCPL-TEST-POL',category:'Quality',documentMeta:{outputStyle:'controlled-document',versionLabel:'1.0',classification:'CONFIDENTIAL',documentType:'POLICY'},contentSchema:[{id:'h1',type:'heading1',text:'Purpose'},{id:'p1',type:'paragraph',text:'Controlled test content.'}],changeDescription:'Initial issue'};
await call(app,'',create,'',401);await call(app,auditor.cookie,create,'',403);
const draft=(await (await call(app,writer.cookie,create,'',201)).json()).template;const id=draft.id;
const current=()=>database.prepare('SELECT * FROM ac_workflows WHERE template_id=?').get(id)!;
await assert.rejects(async()=>adapter.batch([...guard({...current(),revision:99999} as never),adapter.prepare("UPDATE templates SET name='should roll back' WHERE id=?").bind(id)] as unknown as Statement[]));
assert.equal(database.prepare('SELECT name FROM templates WHERE id=?').get(id)!.name,'Test policy');
await call(pdf,stranger.cookie,undefined,'?id='+id,403);await call(docx,stranger.cookie,undefined,'?id='+id,403);await call(workflow,stranger.cookie,undefined,'?id='+id,403);
await call(original,stranger.cookie,undefined,'?id=missing',403);
await call(formPDF,stranger.cookie,undefined,'?id=missing',403);
const foreign=(await (await call(app,stranger.cookie)).json()).templates;assert(!foreign.some((t:{id:string})=>t.id===id));
await call(app,stranger.cookie,{...create,editingTemplateId:id,expectedRevision:0},'',403);
await call(app,writer.cookie,{...create,editingTemplateId:id,expectedRevision:0});
await call(app,writer.cookie,{...create,editingTemplateId:id,expectedRevision:0},'',409);
console.log('PASS: roles, protected Super Admin, direct-file access and draft ownership');
const archive=new JSZip();
archive.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
archive.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Imported purpose</w:t></w:r></w:p><w:p><w:r><w:t>Retained import content.</w:t></w:r></w:p></w:body></w:document>');
archive.file('word/media/fixture.bin',randomBytes(2600000));
const upload=await archive.generateAsync({type:'uint8array',compression:'STORE'});
const form=new FormData();form.set('file',new File([upload as BlobPart],'large-test.docx'));form.set('mode','full');
const imported=await original.POST(new Request('http://formflow.test/api/document/import',{method:'POST',headers:{origin:'http://formflow.test',cookie:writer.cookie},body:form}));assert.equal(imported!.status,200);const importId=(await imported!.json()).source.importId;
const retained=new Uint8Array(await (await call(original,writer.cookie,undefined,'?id='+importId)).arrayBuffer());assert.equal(sha(retained),sha(upload));
await call(original,stranger.cookie,undefined,'?id='+importId,403);
console.log('PASS: authenticated 2.6 MB Word upload, chunk storage, exact original download and import ownership');
const decision=async(cookie:string,action:string,fields:Record<string,unknown>={},status=200)=>call(workflow,cookie,{id,revision:current().revision,action,note:'Test decision note',...fields},'',status);
await decision(writer.cookie,'submit',{reviewerId:writer.id,approverId:director.id},400);
await decision(writer.cookie,'submit',{reviewerId:reviewer.id,approverId:director.id});
await call(app,writer.cookie,{...create,editingTemplateId:id,expectedRevision:current().revision},'',403);
await decision(reviewer.cookie,'changes',{note:''},400);await decision(reviewer.cookie,'changes');
await call(app,writer.cookie,{...create,editingTemplateId:id,expectedRevision:current().revision});
await decision(writer.cookie,'submit',{reviewerId:reviewer.id,approverId:director.id});
await decision(auditor.cookie,'comment',{},403);
await decision(reviewer.cookie,'recommend');assert.equal(current().status,'Recommended for Approval');
await decision(writer.cookie,'submit-approval');
await decision(writer.cookie,'approve',{},403);await decision(superCookie,'approve',{},403);
await decision(director.cookie,'approve');assert.equal(current().status,'Approved');
const approvedPDF=new Uint8Array(await (await call(pdf,writer.cookie,undefined,'?id='+id)).arrayBuffer());
const approvedDOCX=new Uint8Array(await (await call(docx,writer.cookie,undefined,'?id='+id)).arrayBuffer());
const hashes=database.prepare('SELECT * FROM ac_approvals WHERE template_id=?').get(id)!;
assert.equal(sha(approvedPDF),hashes.pdf_hash);assert.equal(sha(approvedDOCX),hashes.docx_hash);
assert.throws(()=>database.prepare('UPDATE templates SET name=? WHERE id=?').run('Tamper',id));
assert.throws(()=>database.prepare('UPDATE ac_audit SET detail=?').run('tamper'));
assert.throws(()=>database.prepare('DELETE FROM ac_snapshots').run());
assert.throws(()=>database.prepare('DELETE FROM ac_files').run());
await decision(director.cookie,'approve',{},403);
const revision=await (await call(app,writer.cookie,{...create,baseTemplateId:id,documentMeta:{...create.documentMeta,versionLabel:'1.1'},changeDescription:'Next version'},'',201)).json();assert(revision.template.id!==id);
assert.equal(sha(new Uint8Array(await (await call(pdf,writer.cookie,undefined,'?id='+id)).arrayBuffer())),hashes.pdf_hash);
console.log('PASS: changes requested, resubmission, independent review, final approval, immutable bytes and history');
await call(workflow,stranger.cookie,{action:'read',id:String(database.prepare('SELECT id FROM ac_notifications WHERE user_id=?').get(director.id)!.id)});assert.equal(database.prepare('SELECT read FROM ac_notifications WHERE user_id=? LIMIT 1').get(director.id)!.read,0);
await call(access,superCookie,{action:'update',id:stranger.id,name:'Stranger',roles:['author'],active:0});await call(app,stranger.cookie,undefined,'',401);
const crossOrigin=new Request('http://formflow.test/api/workflow',{method:'POST',headers:{origin:'http://attacker.test',cookie:writer.cookie,'content-type':'application/json'},body:'{}'});assert.equal((await workflow.POST(crossOrigin))!.status,403);
await call(access,writer.cookie,undefined,'?resource=audit',403);await call(access,auditor.cookie,undefined,'?resource=audit');
assert(database.prepare('SELECT COUNT(*) AS n FROM ac_audit').get()!.n as number>15);
assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');
console.log('PASS: notification ownership, audit visibility, deactivation, CSRF and SQLite integrity');database.close();
