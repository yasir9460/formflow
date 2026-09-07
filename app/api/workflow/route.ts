import { db, parseTemplate, type TemplateRow } from "../../../lib/form-store";
import { admin, author, auditReader, canEdit, canRead, demand, documentAccess, event, fail, flow, guard, has, loadTemplate, notification, now, publicUser, requireUser, sameOrigin, sha, snapshot, userById, uuid, type Flow } from "../../../lib/access";
import { renderPDF } from "../document/pdf/route";
import { renderDOCX } from "../document/docx/route";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{
 const u=await requireUser(request);const id=new URL(request.url).searchParams.get("id");
 if(new URL(request.url).searchParams.get("poll")==="1"){const row=await db().prepare("SELECT COUNT(*) AS count FROM ac_notifications WHERE user_id=? AND read=0").bind(u.id).first<{count:number}>();return Response.json({unread:row?.count||0});}
 if(id){
  await documentAccess(u,id);
  const audit=await db().prepare("SELECT * FROM ac_audit WHERE entity_id=? ORDER BY rowid DESC LIMIT 500").bind(id).all();
  const snapshots=await db().prepare("SELECT id,at,action,sha256,content FROM ac_snapshots WHERE template_id=? ORDER BY at DESC LIMIT 20").bind(id).all();
  const approval=await db().prepare("SELECT * FROM ac_approvals WHERE template_id=?").bind(id).first();
  return Response.json({events:audit.results,snapshots:snapshots.results,approval});
 }
 const all=await db().prepare("SELECT w.*,t.name,t.code,t.version,t.document_meta FROM ac_workflows w JOIN templates t ON t.id=w.template_id ORDER BY w.updated_at DESC").all<Flow>();
 const directory=await db().prepare("SELECT * FROM ac_users WHERE active=1 ORDER BY name").all<Record<string,unknown>>();
 const notices=await db().prepare("SELECT * FROM ac_notifications WHERE user_id=? ORDER BY at DESC LIMIT 100").bind(u.id).all();
 const unread=await db().prepare("SELECT COUNT(*) AS count FROM ac_notifications WHERE user_id=? AND read=0").bind(u.id).first<{count:number}>();
 const legacy=admin(u)?await db().prepare("SELECT id,name,code FROM templates WHERE json_extract(document_meta,'$.outputStyle')='controlled-document' AND id NOT IN (SELECT template_id FROM ac_workflows)").all():{results:[]};
 return Response.json({workflows:all.results.filter(f=>canRead(u,f)),users:directory.results.map(publicUser),notifications:notices.results,unread:unread?.count||0,unassigned:legacy.results});
}catch(e){return fail(e);}}
export async function POST(request:Request){try{
 sameOrigin(request);const u=await requireUser(request);const p=await request.json();const id=String(p.id||"");const action=String(p.action);const note=String(p.note||"").trim();demand(note.length<=4000,"Keep comments within 4,000 characters",400);
 if(action==="read") {await db().prepare("UPDATE ac_notifications SET read=1 WHERE id=? AND user_id=?").bind(id,u.id).run();return Response.json({ok:true});}
 if(action==="assign-legacy"){
  demand(admin(u));demand(note,"Enter an assignment reason",400);const target=await userById(String(p.authorId));demand(author(target),"Choose an author",400);const row=await loadTemplate(id);demand(parseTemplate(row).documentMeta.outputStyle==="controlled-document","Choose a controlled document",400);
  // Existing documents retain their original bytes/content; legacy approval labels do not count as an authenticated approval.
  await db().batch([db().prepare("INSERT INTO ac_workflows(template_id,author_id,status,updated_at) VALUES(?,?,'Draft',?)").bind(id,target.id,now()),snapshot(u,row,"Legacy document before assignment"),db().prepare("UPDATE templates SET document_meta=json_set(document_meta,'$.documentStatus','DRAFT','$.preparedBy',?,'$.reviewedBy','','$.approvedBy','') WHERE id=?").bind(target.name,id),event(u,"Legacy document assigned for controlled review",id,{authorId:target.id,note}),notification(target.id,id,"A legacy document has been assigned to you")]);return Response.json({ok:true});
 }
 const f=await documentAccess(u,id);demand(Number(p.revision)===f.revision,"The document changed. Refresh before trying again",409);const row=await loadTemplate(id);
 const commands=guard(f);let next=f.status;let recipient:string|null=null;
 if(action==="comment"){
  demand(!has(u,"auditor") && (admin(u)||[f.author_id,f.reviewer_id,f.approver_id].includes(u.id)));demand(note,"Write a comment",400);
  commands.push(event(u,"Comment added",id,{note,status:f.status,round:f.round}));
  for(const target of new Set([f.author_id,f.reviewer_id,f.approver_id]))if(target && target!==u.id)commands.push(notification(target,id,`${u.name} added a comment`));
 }else if(action==="assign"){
  demand(admin(u));demand(["Draft","Changes Requested"].includes(f.status),"Return the document for changes before reassigning",409);demand(note,"Enter an assignment reason",400);
  const target=await userById(String(p.authorId));demand(author(target),"Choose an author",400);
  commands.push(db().prepare("UPDATE ac_workflows SET author_id=?,reviewer_id=NULL,approver_id=NULL WHERE template_id=?").bind(target.id,id),event(u,"Author reassigned",id,{before:f.author_id,after:target.id,note}),notification(target.id,id,"A document has been assigned to you"));
 }else if(action==="submit"){
  demand(canEdit(u,f));demand(note,"Add a submission note",400);
  const reviewer=await userById(String(p.reviewerId)),approver=await userById(String(p.approverId));
  demand(has(reviewer,"reviewer","admin","super_admin") && has(approver,"approver","super_admin"),"Choose a permitted reviewer and approver",400);
  const contributors=await db().prepare("SELECT DISTINCT user_id FROM ac_snapshots WHERE template_id=? AND action='Draft saved'").bind(id).all<{user_id:string}>();
  const prepared=new Set([f.author_id,...contributors.results.map(r=>r.user_id)]);
  demand(!prepared.has(reviewer.id)&&!prepared.has(approver.id)&&reviewer.id!==approver.id,"Author, reviewer and approver must be different people; contributors cannot review or approve",400);
  next="Submitted for Review";recipient=reviewer.id;
  commands.push(db().prepare("UPDATE ac_workflows SET reviewer_id=?,approver_id=?,round=round+1 WHERE template_id=?").bind(reviewer.id,approver.id,id),snapshot(u,row,"Submitted for review"));
 }else if(action==="recommend"){
  demand(f.status==="Submitted for Review" && f.reviewer_id===u.id && has(u,"reviewer","admin","super_admin") && f.author_id!==u.id);
  demand(note,"Enter your review recommendation",400);next="Recommended for Approval";recipient=f.author_id;
  commands.push(db().prepare("UPDATE templates SET document_meta=json_set(document_meta,'$.reviewedBy',?) WHERE id=?").bind(u.name,id));
 }else if(action==="submit-approval"){
  demand(f.author_id===u.id && author(u) && f.status==="Recommended for Approval");
  await userById(f.approver_id||"");demand(note,"Enter an approval submission note",400);next="Submitted for Approval";recipient=f.approver_id;
 }else if(action==="changes"){
  demand((f.status==="Submitted for Review" && f.reviewer_id===u.id && has(u,"reviewer","admin","super_admin")) || (f.status==="Submitted for Approval" && f.approver_id===u.id && has(u,"approver","super_admin")) || (admin(u) && ["Submitted for Review","Recommended for Approval","Submitted for Approval"].includes(f.status)),"You cannot return this document at this stage");
  demand(note,"Describe the required changes",400);next="Changes Requested";recipient=f.author_id;
 }else if(action==="approve"){
  demand(f.status==="Submitted for Approval" && f.approver_id===u.id && has(u,"approver","super_admin") && f.author_id!==u.id);
  const contributed=await db().prepare("SELECT id FROM ac_snapshots WHERE template_id=? AND user_id=? AND action='Draft saved'").bind(id,u.id).first();demand(!contributed,"A contributor cannot approve this document");
  demand(note,"Enter an approval decision note",400);next="Approved";recipient=f.author_id;
  const meta={...parseTemplate(row).documentMeta,documentStatus:"APPROVED",approvedBy:u.name,effectiveDate:parseTemplate(row).documentMeta.effectiveDate||now().slice(0,10)};
  const frozen={...row,document_meta:JSON.stringify(meta),updated_at:now()};const template=parseTemplate(frozen);
  const previous=await db().prepare("SELECT * FROM templates WHERE code=? AND version<? ORDER BY version").bind(row.code,row.version).all<TemplateRow>();const history=[...previous.results.map(parseTemplate),template];
  const pdf=await renderPDF(template,history);const docx=await renderDOCX(template,history);const pdfHash=sha(pdf),docxHash=sha(docx),contentHash=sha(JSON.stringify(template));
  commands.push(db().prepare("UPDATE templates SET document_meta=?,updated_at=? WHERE id=?").bind(frozen.document_meta,frozen.updated_at,id),snapshot(u,frozen,"Approved"),db().prepare("INSERT INTO ac_approvals(template_id,at,approver_id,pdf_hash,docx_hash,content_hash) VALUES(?,?,?,?,?,?)").bind(id,now(),u.id,pdfHash,docxHash,contentHash));
  for(const [format,bytes] of [["pdf",pdf],["docx",docx]] as const){for(let offset=0,part=0;offset<bytes.byteLength;offset+=256*1024,part++){const chunk=bytes.slice(offset,offset+256*1024);commands.push(db().prepare("INSERT INTO ac_files(id,template_id,format,part,bytes) VALUES(?,?,?,?,?)").bind(uuid(),id,format,part,chunk));}}
  const earlier=await db().prepare("SELECT w.* FROM ac_workflows w JOIN templates t ON w.template_id=t.id WHERE t.code=? AND t.version<? AND w.status='Approved'").bind(row.code,row.version).all<Flow>();
  for(const old of earlier.results)commands.push(...guard(old),db().prepare("UPDATE ac_workflows SET status='Superseded' WHERE template_id=?").bind(old.template_id),event(u,"Superseded",old.template_id,{replacedBy:id}));
  commands.push(event(u,"Approved output hashes recorded",id,{pdfHash,docxHash,contentHash}));
 }else if(action==="archive"){
  demand(admin(u) && ["Approved","Superseded"].includes(f.status));demand(note,"Enter an archive reason",400);next="Archived";recipient=f.author_id;
 }else demand(false,"Unknown workflow action",400);
 if(!["comment","assign"].includes(action)){
  commands.push(db().prepare("UPDATE ac_workflows SET status=? WHERE template_id=?").bind(next,id),event(u,action,id,{from:f.status,to:next,note,round:action==="submit"?f.round+1:f.round,code:row.code,version:parseTemplate(row).documentMeta.versionLabel}));
  if(recipient)commands.push(notification(recipient,id,`${row.code} · ${row.name}: ${next}`));
 }
 await db().batch(commands);return Response.json({ok:true});
}catch(e){return fail(e);}}
