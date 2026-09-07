import { db, ensureSchema } from "../../../../lib/form-store";
import { importDocx } from "../../../../lib/docx-importer";
import { requireUser, sameOrigin, author, admin, demand, documentAccess, event, fail, uuid } from "../../../../lib/access";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ARCHIVE_CHUNK_SIZE = 256 * 1024;

function safeFilename(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || "imported-document.docx";
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function asBytes(value: ArrayBuffer | ArrayBufferView) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireUser(request);
    demand(author(actor));
    await ensureSchema();
    const form = await request.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "full" ? "full" : "auto";
    if (!(file instanceof File)) return Response.json({ error: "Choose a Word DOCX file to import." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".docx")) return Response.json({ error: "Only modern Word .docx files are supported. Convert older .doc files to .docx first." }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_SIZE) return Response.json({ error: "The Word file must be smaller than 8 MB." }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return Response.json({ error: "The uploaded file is not a valid DOCX package." }, { status: 400 });
    const imported = await importDocx(bytes, mode);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const id = crypto.randomUUID();
    const importedAt = new Date().toISOString();
    const fileName = safeFilename(file.name);
    const database = db();
    const statements = [database.prepare(`INSERT INTO document_imports
      (id, template_id, file_name, mime_type, file_size, sha256, file_data, imported_by, imported_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      fileName,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file.size,
      sha256,
      new ArrayBuffer(0),
      actor.name,
      importedAt,
    )];
    for (let offset = 0, chunkIndex = 0; offset < bytes.byteLength; offset += ARCHIVE_CHUNK_SIZE, chunkIndex += 1) {
      const chunk = bytes.slice(offset, Math.min(offset + ARCHIVE_CHUNK_SIZE, bytes.byteLength));
      statements.push(database.prepare(`INSERT INTO document_import_chunks
        (import_id, chunk_index, chunk_data) VALUES (?, ?, ?)`).bind(
        id,
        chunkIndex,
        chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      ));
    }
    statements.push(database.prepare("INSERT INTO ac_ownership(id,kind,entity_id,user_id) VALUES(?,'import',?,?)").bind(uuid(),id,actor.id), event(actor,"Word imported",id,{fileName,sha256}));
    await database.batch(statements);

    return Response.json({
      ...imported,
      source: { importId: id, fileName, fileSize: file.size, sha256, importedBy: actor.name, importedAt },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor=await requireUser(request);
    await ensureSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Import ID is required." }, { status: 400 });
    const database = db();
    const owner=await database.prepare("SELECT user_id FROM ac_ownership WHERE kind='import' AND entity_id=?").bind(id).first<{user_id:string}>();
    if(!admin(actor) && owner?.user_id!==actor.id){
      const linked=await database.prepare("SELECT id FROM templates WHERE source_import_id=?").bind(id).all<{id:string}>();
      let permitted=false;for(const item of linked.results){try{await documentAccess(actor,item.id);permitted=true;break;}catch{/* examine the next linked version */}}
      demand(permitted);
    }
    const row = await database.prepare("SELECT file_name, mime_type, file_size, file_data, sha256 FROM document_imports WHERE id = ?").bind(id).first<{
      file_name: string;
      mime_type: string;
      file_size: number;
      file_data: ArrayBuffer | ArrayBufferView;
      sha256: string;
    }>();
    if (!row) return Response.json({ error: "The original imported file was not found." }, { status: 404 });
    const chunkRows = await database.prepare(`SELECT chunk_data FROM document_import_chunks
      WHERE import_id = ? ORDER BY chunk_index`).bind(id).all<{ chunk_data: ArrayBuffer | ArrayBufferView }>();
    let fileData: Uint8Array;
    if (chunkRows.results.length) {
      fileData = new Uint8Array(row.file_size);
      let offset = 0;
      for (const chunkRow of chunkRows.results) {
        const chunk = asBytes(chunkRow.chunk_data);
        fileData.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (offset !== row.file_size) return Response.json({ error: "The archived Word file is incomplete." }, { status: 500 });
    } else {
      fileData = asBytes(row.file_data);
    }
    const actualHash=hex(await crypto.subtle.digest("SHA-256",fileData as BufferSource));
    demand(actualHash===row.sha256,"Original Word integrity check failed; contact the VM administrator",409);
    await event(actor,"Original Word downloaded",id,{sha256:actualHash}).run();
    return new Response(fileData as BodyInit, {
      headers: {
        "content-type": row.mime_type,
        "content-disposition": `attachment; filename="${safeFilename(row.file_name)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
