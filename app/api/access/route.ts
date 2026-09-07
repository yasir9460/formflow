import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "../../../lib/form-store";
import { admin, auditReader, demand, event, fail, has, now, passwordHash, publicUser, requireUser, roles, sameOrigin, userById, uuid, type Role } from "../../../lib/access";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{
 const u=await requireUser(request);const q=new URL(request.url).searchParams;
 if(q.get("resource")==="audit"){
  demand(auditReader(u));const before=q.get("before") || String(Number.MAX_SAFE_INTEGER);
  demand(Number.isSafeInteger(Number(before)) && Number(before)>0,"Invalid audit page",400);
  const entries=await db().prepare("SELECT rowid AS sequence,* FROM ac_audit WHERE rowid<? ORDER BY rowid DESC LIMIT 500").bind(Number(before)).all<Record<string,unknown>>();
  const format=q.get("format");
  if(format==="csv" || format==="pdf"){
   await event(u,"Audit exported","",{format,rows:entries.results.length,before}).run();
   if(format==="csv"){
    const quote=(v:unknown)=>'"'+String(v??"").replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
    const csv=["sequence,at,actor,roles,action,entity_id,detail",...entries.results.map(r=>[r.sequence,r.at,r.actor,r.roles,r.action,r.entity_id,r.detail].map(quote).join(","))].join("\r\n");
    return new Response(csv,{headers:{"content-type":"text/csv;charset=utf-8","content-disposition":"attachment; filename=ccpl-audit.csv","cache-control":"no-store"}});
   }
   const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);let page=pdf.addPage();let y=800;
   const line=(s:string)=>{if(y<45){page=pdf.addPage();y=800;}page.drawText(s.replace(/[^\x20-\x7e]/g,"?"),{x:35,y,size:9,font});y-=13;};
   line("CCPL FormFlow - audit history (up to 500 events per export)");
   for(const r of entries.results){const text=`#${r.sequence} ${r.at} | ${r.actor} | ${r.action} | ${r.entity_id} | ${r.detail}`;for(let i=0;i<text.length;i+=100)line(text.slice(i,i+100));y-=6;}
   return new Response(await pdf.save() as BodyInit,{headers:{"content-type":"application/pdf","content-disposition":"attachment; filename=ccpl-audit.pdf","cache-control":"no-store"}});
  }
  return Response.json({events:entries.results,next:entries.results.length===500?entries.results.at(-1)?.sequence:null});
 }
 demand(admin(u));const users=await db().prepare("SELECT * FROM ac_users ORDER BY name").all<Record<string,unknown>>();return Response.json({users:users.results.map(publicUser)});
}catch(e){return fail(e);}}
export async function POST(request:Request){try{
 sameOrigin(request);const u=await requireUser(request);demand(admin(u));const p=await request.json();
 const chosen=Array.isArray(p.roles)?[...new Set(p.roles)] as Role[]:[];
 if(p.action==="create" || p.action==="update"){
  demand(chosen.length && chosen.every(r=>roles.includes(r)&&r!=="super_admin"),"Choose valid roles; Super Admin is managed offline",400);
  demand(!chosen.includes("admin")||has(u,"super_admin"),"Only the Super Admin can appoint an Admin");
  demand(!chosen.includes("auditor")||chosen.length===1,"Auditor is a strictly read-only role and cannot be combined",400);
  const name=String(p.name||"").trim();demand(name && name.length<=120,"Enter a name of up to 120 characters",400);
  if(p.action==="create"){
   const username=String(p.username||"").toLowerCase().trim();demand(/^[a-z0-9._-]{3,80}$/.test(username),"Use 3–80 letters, numbers, dots, dashes or underscores for the username",400);
   const exists=await db().prepare("SELECT id FROM ac_users WHERE username=?").bind(username).first();demand(!exists,"That username is already in use",409);
   const id=uuid();await db().batch([db().prepare("INSERT INTO ac_users(id,username,name,email,roles,password,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,username,name,String(p.email||"").slice(0,200),JSON.stringify(chosen),passwordHash(String(p.password||"")),now()),event(u,"User created",id,{username,roles:chosen})]);
  }else{
   const raw=await db().prepare("SELECT * FROM ac_users WHERE id=?").bind(String(p.id)).first<Record<string,unknown>>();demand(raw,"User not found",404);const target=publicUser(raw);
   demand(!has(target,"super_admin") && (!has(target,"admin")||has(u,"super_admin")),"This account is protected");demand(target.id!==u.id,"Ask another administrator to change your permissions");
   await db().batch([db().prepare("UPDATE ac_users SET name=?,email=?,roles=?,active=? WHERE id=?").bind(name,String(p.email||"").slice(0,200),JSON.stringify(chosen),p.active?1:0,target.id),db().prepare("DELETE FROM ac_sessions WHERE user_id=?").bind(target.id),event(u,"User access changed",target.id,{before:{roles:target.roles,active:target.active},after:{roles:chosen,active:!!p.active}})]);
  }
 }else if(p.action==="reset"){
  const target=await userById(String(p.id));demand(!has(target,"super_admin") && (!has(target,"admin")||has(u,"super_admin")),"Use offline recovery for protected accounts");
  await db().batch([db().prepare("UPDATE ac_users SET password=?,must_change=1 WHERE id=?").bind(passwordHash(String(p.password||"")),target.id),db().prepare("DELETE FROM ac_sessions WHERE user_id=?").bind(target.id),event(u,"Temporary password reset; sessions revoked",target.id)]);
 }else demand(false,"Unknown action",400);
 return Response.json({ok:true});
}catch(e){return fail(e);}}
