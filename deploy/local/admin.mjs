import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync, lstatSync } from 'node:fs';
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import path from 'node:path';
import { migrate } from './migrate.mjs';

const action=process.argv[2];
if(!['migrate','init','recover'].includes(action))throw Error('Use migrate, init or recover');
// The override supports isolated local administration/tests; Docker uses /data.
const directory=path.join(process.env.FORMFLOW_DATA_DIR || '/data','v3/d1/miniflare-D1DatabaseObject');
if(!existsSync(directory))throw Error('No local D1 database found. Run the installer first.');
const candidates=[];
const uninitialized=[];
for(const name of readdirSync(directory)){
 if(!name.endsWith('.sqlite') || name.toLowerCase()==='metadata.sqlite')continue;
 const filename=path.join(directory,name);
 const stat=lstatSync(filename);
 if(stat.isSymbolicLink() || !stat.isFile())continue;
 const isD1File=/^[a-f0-9]{64}\.sqlite$/i.test(name);
 let probe;
 try{
  probe=new DatabaseSync(filename,{readOnly:true});
  const tables=probe.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name);
  if(tables.includes('templates'))candidates.push(name);
  // A newly initialized D1 file has only Miniflare/SQLite bookkeeping.
  // Never migrate arbitrary SQLite files merely because they are the only file.
  else if(isD1File && tables.every(table=>table==='_cf_METADATA' || table.startsWith('sqlite_')))uninitialized.push(name);
 }catch(error){
  // An unreadable D1-shaped file might be the application DB. Fail closed.
  if(isD1File)throw new Error('Cannot inspect a possible FormFlow database; no changes made.',{cause:error});
 }finally{probe?.close();}
}
const file=candidates.length===1?candidates[0]:
 candidates.length===0 && action==='migrate' && uninitialized.length===1?uninitialized[0]:null;
if(!file)throw Error('Cannot identify exactly one FormFlow database; no changes made.');
const database=new DatabaseSync(path.join(directory,file));migrate(database);
if(action==='migrate'){console.log('Schema and integrity check complete.');database.close();process.exit(0);}
const existing=database.prepare("SELECT id FROM ac_users WHERE id='super-admin'").get();
if(action==='init'&&existing)throw Error('Super Admin already exists. Use recover only if you need to reset it.');
if(action==='recover'&&!existing)throw Error('No Super Admin exists. Use init first.');
const password=randomBytes(24).toString('base64url');const salt=randomBytes(16).toString('hex');
const digest='pbkdf2-sha256$600000$'+salt+'$'+pbkdf2Sync(password,salt,600000,32,'sha256').toString('hex');
const at=new Date().toISOString();database.exec('BEGIN IMMEDIATE');
try{
 if(existing)database.prepare("UPDATE ac_users SET password=?,must_change=1 WHERE id='super-admin'").run(digest);
 else database.prepare("INSERT INTO ac_users(id,username,name,email,roles,password,created_at) VALUES('super-admin','superadmin',?,'','[\"super_admin\"]',?,?)").run(process.argv[3]||'Super Administrator',digest,at);
 database.prepare("DELETE FROM ac_sessions WHERE user_id='super-admin'").run();
 database.prepare('INSERT INTO ac_audit(id,at,user_id,actor,roles,action,entity_id,detail) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),at,'super-admin','Offline VM administrator','["host_admin"]',existing?'Super Admin recovered offline':'Super Admin initialized offline','super-admin','{"mustChangePassword":true,"allSessionsRevoked":true}');
 database.exec('COMMIT');
}catch(e){database.exec('ROLLBACK');throw e;}finally{database.close();}
console.log('Username: superadmin\nTemporary password: '+password+'\nSign in and replace it immediately. This password is shown once; do not share it.');
