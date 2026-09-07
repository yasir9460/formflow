import { db, defaultDocumentMeta, parseTemplate, type DocumentMeta, type TemplateRow } from "./form-store";
import { author, canEdit, demand, documentAccess, event, guard, loadTemplate, now, snapshot, uuid, type User } from "./access";
export async function saveDocument(u:User,p:Record<string,unknown>) {
 demand(author(u));const name=String(p.name||"").trim(),code=String(p.code||"").trim().toUpperCase();
 demand(name.length>0&&name.length<=200&&/^[A-Z0-9-]{3,80}$/.test(code),"Enter a title (up to 200 characters) and a valid document ID",400);
 const content=JSON.stringify(p.contentSchema||[]);demand(Array.isArray(p.contentSchema)&&p.contentSchema.length>0,"Add document content",400);
 demand(new TextEncoder().encode(content).length<=700000,"This document is too large to save as editable blocks. Reduce embedded image sizes",413);
 const editId=String(p.editingTemplateId||"");const baseId=String(p.baseTemplateId||"");let version=1;let original:TemplateRow|undefined;
 const commands:D1PreparedStatement[]=[];
 if(editId){original=await loadTemplate(editId);const f=await documentAccess(u,editId);demand(canEdit(u,f),"Only the assigned author can edit a draft");demand(Number(p.expectedRevision)===f.revision,"This draft changed in another session. Reopen it before saving",409);commands.push(...guard(f));demand(code===original.code,"A saved document ID cannot change",400);version=original.version;}
 else if(baseId){original=await loadTemplate(baseId);const f=await documentAccess(u,baseId);demand(f.author_id===u.id&&["Approved","Superseded"].includes(f.status),"Create a new version from an approved document assigned to you");demand(code===original.code,"A new version must keep the document ID",400);demand(String(p.changeDescription||"").trim(),"Describe the new version's changes",400);
  const latest=await db().prepare("SELECT MAX(version) AS version FROM templates WHERE code=?").bind(code).first<{version:number}>();version=(latest?.version||original.version)+1;
  const pending=await db().prepare("SELECT w.template_id FROM ac_workflows w JOIN templates t ON t.id=w.template_id WHERE t.code=? AND w.status NOT IN ('Approved','Superseded','Archived')").bind(code).first();demand(!pending,"A draft version of this document already exists",409);
 }else{const exists=await db().prepare("SELECT id FROM templates WHERE code=?").bind(code).first();demand(!exists,"That ID already exists. Open its approved version to create a revision",409);}
 const incoming=(p.documentMeta||{}) as Partial<DocumentMeta>;
 const meta={...defaultDocumentMeta,...incoming,outputStyle:"controlled-document",documentStatus:"DRAFT",preparedBy:u.name,reviewedBy:"",approvedBy:""};
 demand(["PUBLIC","INTERNAL","CONFIDENTIAL"].includes(meta.classification),"Choose PUBLIC, INTERNAL or CONFIDENTIAL",400);
 demand(/^[0-9]+(?:\.[0-9]+){0,2}$/.test(meta.versionLabel),"Use a numeric version label such as 1.0",400);
 if(!editId&&baseId)demand(meta.versionLabel!==parseTemplate(original!).documentMeta.versionLabel,"Increase the version label for this new version",400);
 const duplicateLabel=await db().prepare("SELECT id FROM templates WHERE code=? AND json_extract(document_meta,'$.versionLabel')=? AND id<>?").bind(code,meta.versionLabel,editId).first();demand(!duplicateLabel,"That version label already exists",409);
 const id=editId||uuid(),at=now();let sourceId=String(p.sourceImportId||"");let sourceName="",sourceHash="";
 if(sourceId){const source=await db().prepare("SELECT i.* FROM document_imports i JOIN ac_ownership o ON o.entity_id=i.id AND o.kind='import' WHERE i.id=? AND o.user_id=?").bind(sourceId,u.id).first<{file_name:string;sha256:string}>();
  if(!source && sourceId===original?.source_import_id){sourceName=original.source_file_name||"";sourceHash=original.source_file_hash||"";}
  else {demand(source,"You cannot attach that import");sourceName=source.file_name;sourceHash=source.sha256;}
 }
 if(!sourceId&&original?.source_import_id){sourceId=original.source_import_id;sourceName=original.source_file_name||"";sourceHash=original.source_file_hash||"";}
 const row:TemplateRow={id,name,code,version,category:String(p.category||"General").slice(0,100),description:String(p.description||"").slice(0,4000),field_schema:"[]",document_meta:JSON.stringify(meta),content_schema:content,change_description:String(p.changeDescription||"Initial issue").slice(0,4000),revision_date:String(p.revisionDate||at.slice(0,10)),base_template_id:editId?original?.base_template_id||null:baseId||null,source_import_id:sourceId||null,source_file_name:sourceName,source_file_hash:sourceHash,import_summary:JSON.stringify(p.importSummary||{}),numbering_pattern:"",layout_file_path:null,status:"Active",created_by:original&&editId?original.created_by:u.name,created_at:original&&editId?original.created_at:at,updated_at:at};
 if(editId){commands.push(snapshot(u,original!,"Before draft save"),db().prepare("UPDATE templates SET name=?,category=?,description=?,document_meta=?,content_schema=?,change_description=?,revision_date=?,source_import_id=?,source_file_name=?,source_file_hash=?,import_summary=?,updated_at=? WHERE id=?").bind(row.name,row.category,row.description,row.document_meta,content,row.change_description,row.revision_date,row.source_import_id,sourceName,sourceHash,row.import_summary,at,id));}
 else{commands.push(db().prepare("INSERT INTO templates(id,name,code,version,category,description,field_schema,document_meta,content_schema,change_description,revision_date,base_template_id,source_import_id,source_file_name,source_file_hash,import_summary,numbering_pattern,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,?,?,?,?,?,?,?,'','Active',?,?,?)").bind(id,name,code,version,row.category,row.description,row.document_meta,content,row.change_description,row.revision_date,row.base_template_id,row.source_import_id,sourceName,sourceHash,row.import_summary,u.name,at,at),db().prepare("INSERT INTO ac_workflows(template_id,author_id,updated_at) VALUES(?,?,?)").bind(id,u.id,at));}
 commands.push(snapshot(u,row,"Draft saved"),event(u,editId?"Draft saved":"Document created",id,{code,version:meta.versionLabel,baseId,sourceHash}));
 await db().batch(commands);return Response.json({template:parseTemplate(row)},{status:editId?200:201});
}
