import { db } from "../../../lib/form-store";
import { cookie, demand, event, fail, now, passwordHash, passwordMatches, publicUser, requireUser, sameOrigin, sha, tokenFrom, uuid } from "../../../lib/access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { return Response.json({user:await requireUser(request,true)}, {headers:{"cache-control":"no-store"}}); } catch(e) {return fail(e);} }
export async function POST(request: Request) {
 try {
  sameOrigin(request);
  const p = await request.json() as Record<string,string>;
  if(p.action === "login") {
   const username = String(p.username || "").trim().toLowerCase(); const password = String(p.password || "");
   demand(username.length <= 80 && password.length <= 128,"Invalid sign-in details",400);
   const cutoff = new Date(Date.now()-15*60*1000).toISOString();
   // Record the attempt before hashing. Persisted per-account and global limits survive restarts.
   await db().prepare("DELETE FROM ac_attempts WHERE at<?").bind(cutoff).run();
   await db().prepare("INSERT INTO ac_attempts(id,username,at) VALUES(?,?,?)").bind(uuid(),username,now()).run();
   const limits = await db().prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN username=? THEN 1 ELSE 0 END) AS account FROM ac_attempts WHERE at>=?").bind(username,cutoff).first<{total:number;account:number}>();
   if(!limits || limits.account>10 || limits.total>100){await event(null,"Sign-in rate limited","",{username}).run();demand(false,"Too many sign-in attempts. Wait 15 minutes",429);}
   const row = await db().prepare("SELECT * FROM ac_users WHERE username=?").bind(username).first<Record<string,unknown>>();
   // Identical expensive hash for unknown accounts; no username enumeration.
   const valid = passwordMatches(password, String(row?.password || "pbkdf2-sha256$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000"));
   if(!row || !row.active || !valid) { await event(null,"Login failed","",{username}).run(); demand(false,"Username or password is incorrect",401); }
   const u = publicUser(row); const token = uuid()+uuid();
   await db().batch([
    db().prepare("DELETE FROM ac_sessions WHERE expires_at<? OR last_seen<?").bind(now(),new Date(Date.now()-30*60*1000).toISOString()),
    db().prepare("INSERT INTO ac_sessions(token_hash,user_id,expires_at,last_seen) VALUES(?,?,?,?)").bind(sha(token),u.id,new Date(Date.now()+8*60*60*1000).toISOString(),now()),
    event(u,"Signed in"),
   ]);
   return Response.json({user:u},{headers:{"set-cookie":cookie(request,token),"cache-control":"no-store"}});
  }
  const u=await requireUser(request,true);
  if(p.action==="logout") { await db().batch([db().prepare("DELETE FROM ac_sessions WHERE token_hash=?").bind(sha(tokenFrom(request))),event(u,"Signed out")]);return Response.json({ok:true},{headers:{"set-cookie":cookie(request,"",0)}}); }
  if(p.action==="password") {
   const row=await db().prepare("SELECT password FROM ac_users WHERE id=?").bind(u.id).first<{password:string}>();
   demand(row && passwordMatches(String(p.currentPassword || ""),row.password),"Current password is incorrect",400);
   demand(p.password!==p.currentPassword,"Choose a different password",400);
   const hash=passwordHash(String(p.password || ""));
   await db().batch([db().prepare("UPDATE ac_users SET password=?,must_change=0 WHERE id=?").bind(hash,u.id),db().prepare("DELETE FROM ac_sessions WHERE user_id=?").bind(u.id),event(u,"Password changed; all sessions revoked")]);
   return Response.json({ok:true},{headers:{"set-cookie":cookie(request,"",0)}});
  }
  demand(false,"Unknown action",400);
 } catch(e){return fail(e);}
}
