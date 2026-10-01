import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync } from 'node:crypto';
import { migrate } from '../deploy/local/migrate.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const first='faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const second='a'.repeat(64)+'.sqlite';

function fixture(t){
 const data=mkdtempSync(path.join(tmpdir(),'formflow-admin-'));
 t.after(()=>rmSync(data,{recursive:true,force:true}));
 const directory=path.join(data,'v3/d1/miniflare-D1DatabaseObject');
 mkdirSync(directory,{recursive:true});
 const create=(name,sql)=>{const db=new DatabaseSync(path.join(directory,name));try{if(sql)db.exec(sql);}finally{db.close();}};
 const run=(action)=>spawnSync(process.execPath,[path.join(root,'deploy/local/admin.mjs'),action,'Test Administrator'],{
  cwd:root,env:{...process.env,FORMFLOW_DATA_DIR:data},encoding:'utf8',timeout:15000,
 });
 const query=(sql)=>{const db=new DatabaseSync(path.join(directory,first),{readOnly:true});try{return db.prepare(sql).get();}finally{db.close();}};
 const snapshot=(name)=>readFileSync(path.join(directory,name));
 return {data,directory,create,run,query,snapshot};
}

test('fresh setup: metadata plus one D1 database migrates, initializes and recovers Super Admin',t=>{
 const f=fixture(t);
 f.create('metadata.sqlite','CREATE TABLE _cf_ALARM (id TEXT);');
 f.create(first,'CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY, value BLOB);');
 const metadata=f.snapshot('metadata.sqlite');
 assert.equal(f.run('migrate').status,0);
 const init=f.run('init');
 assert.equal(init.status,0,init.stderr);
 assert.match(init.stdout,/Username: superadmin/);
 const password=init.stdout.match(/Temporary password: ([A-Za-z0-9_-]{32})/)[1];
 const user=f.query("SELECT * FROM ac_users WHERE id='super-admin'");
 assert.equal(user.username,'superadmin');
 assert.equal(user.name,'Test Administrator');
 assert.equal(user.must_change,1);
 const [scheme,iterations,salt,digest]=user.password.split('$');
 assert.equal(scheme,'pbkdf2-sha256');
 assert.equal(pbkdf2Sync(password,salt,Number(iterations),32,'sha256').toString('hex'),digest);
 assert.notEqual(f.run('init').status,0);
 assert.equal(f.run('migrate').status,0);
 assert.equal(f.query('SELECT COUNT(*) AS n FROM ac_users').n,1);
 assert.equal(f.run('recover').status,0);
 assert.notEqual(f.query("SELECT password FROM ac_users WHERE id='super-admin'").password,user.password);
 assert.deepEqual(f.snapshot('metadata.sqlite'),metadata);
});

test('future non-application databases and non-SQLite files are left untouched',t=>{
 const f=fixture(t);
 f.create('metadata.sqlite','CREATE TABLE _cf_ALARM (id TEXT);');
 f.create('future.sqlite','CREATE TABLE bookkeeping (id TEXT);');
 f.create(second,'CREATE TABLE unrelated (id TEXT);');
 writeFileSync(path.join(f.directory,'broken.sqlite'),'not SQLite');
 mkdirSync(path.join(f.directory,'directory.sqlite'));
 f.create(first,'CREATE TABLE _cf_METADATA (key TEXT);');
 const before=['metadata.sqlite','future.sqlite',second,'broken.sqlite'].map(n=>[n,f.snapshot(n)]);
 assert.equal(f.run('migrate').status,0);
 assert.equal(f.run('init').status,0);
 for(const [name,bytes] of before)assert.deepEqual(f.snapshot(name),bytes);
});

test('templates table identifies an existing database regardless of its filename',t=>{
 const f=fixture(t);
 f.create('legacy.sqlite','');
 const legacy=new DatabaseSync(path.join(f.directory,'legacy.sqlite'));
 migrate(legacy);legacy.close();
 f.create(first,'CREATE TABLE _cf_METADATA (key TEXT);');
 const before=f.snapshot(first);
 assert.equal(f.run('migrate').status,0);
 assert.equal(f.run('init').status,0);
 const check=new DatabaseSync(path.join(f.directory,'legacy.sqlite'),{readOnly:true});
 assert.equal(check.prepare("SELECT COUNT(*) AS n FROM ac_users WHERE id='super-admin'").get().n,1);
 check.close();
 assert.deepEqual(f.snapshot(first),before);
});

for(const kind of ['metadata only','unrelated only','two fresh databases','two application databases','corrupt D1 file','symlink only']){
 test('fails without changing files: '+kind,t=>{
  const f=fixture(t);
  f.create('metadata.sqlite','CREATE TABLE _cf_ALARM (id TEXT);');
  if(kind==='unrelated only')f.create('other.sqlite','CREATE TABLE unrelated (id TEXT);');
  if(kind==='two fresh databases'){
   f.create(first,'CREATE TABLE _cf_METADATA (key TEXT);');f.create(second,'');
  }
  if(kind==='two application databases'){
   f.create(first,'CREATE TABLE templates (id TEXT);');f.create(second,'CREATE TABLE templates (id TEXT);');
  }
  if(kind==='corrupt D1 file'){
   f.create(first,'CREATE TABLE _cf_METADATA (key TEXT);');writeFileSync(path.join(f.directory,second),'broken');
  }
  if(kind==='symlink only'){
   const outside=path.join(f.data,'outside.sqlite');writeFileSync(outside,'');symlinkSync(outside,path.join(f.directory,first));
  }
  const unchanged=readdirSync(f.directory).filter(n=>lstatSync(path.join(f.directory,n)).isFile()).map(n=>[n,f.snapshot(n)]);
  const result=f.run('migrate');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/no changes made/);
  for(const [name,bytes] of unchanged)assert.deepEqual(f.snapshot(name),bytes);
 });
}

test('init/recover do not guess an uninitialized database',t=>{
 const f=fixture(t);f.create(first,'CREATE TABLE _cf_METADATA (key TEXT);');
 const before=f.snapshot(first);
 for(const action of ['init','recover'])assert.notEqual(f.run(action).status,0);
 assert.deepEqual(f.snapshot(first),before);
});
