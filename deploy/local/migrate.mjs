import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function migrate(database, migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle')) {
  database.exec('CREATE TABLE IF NOT EXISTS ff_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const journal=JSON.parse(readFileSync(path.join(migrationDirectory,'meta/_journal.json'),'utf8'));
  for(const entry of journal.entries){
    const name=entry.tag;const sql=readFileSync(path.join(migrationDirectory,name+'.sql'),'utf8');const hash=createHash('sha256').update(sql).digest('hex');
    const applied=database.prepare('SELECT sha256 FROM ff_migrations WHERE name=?').get(name);
    if(applied){if(applied.sha256!==hash)throw Error('Applied migration changed: '+name);continue;}
    database.exec('BEGIN IMMEDIATE');
    try{
      for(let statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)){
        // Bridge the historical v0.4.2 runtime-created schema to tracked migrations.
        // Only known pre-0.5 migrations may skip existing tables/columns; later migrations are strict.
        if(entry.idx<=1){
          const create=statement.match(/^CREATE TABLE\s+[`"]?(\w+)[`"]?/i);
          if(create && database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(create[1]))continue;
          const alter=statement.match(/^ALTER TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+[`"]?(\w+)[`"]?/i);
          if(alter && database.prepare('PRAGMA table_info('+JSON.stringify(alter[1])+')').all().some(c=>c.name===alter[2]))continue;
          statement=statement.replace(/^CREATE (UNIQUE )?INDEX /i,(_,unique)=>'CREATE '+(unique||'')+'INDEX IF NOT EXISTS ');
        }
        database.exec(statement);
      }
      database.prepare('INSERT INTO ff_migrations VALUES(?,?,?)').run(name,hash,new Date().toISOString());database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
  }
  const check=database.prepare('PRAGMA integrity_check').get();if(check.integrity_check!=='ok')throw Error('Database integrity check failed');
}
