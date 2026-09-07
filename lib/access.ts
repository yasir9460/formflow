import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { db, parseTemplate, type TemplateRow } from "./form-store";

export const roles = ["super_admin", "admin", "author", "reviewer", "approver", "auditor"] as const;
export type Role = typeof roles[number];
export type User = { id: string; username: string; name: string; email: string; roles: Role[]; active: number; must_change: number };
export type Flow = { template_id: string; author_id: string; reviewer_id: string | null; approver_id: string | null; status: string; revision: number; round: number; updated_at: string };
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const sha = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
export const has = (u: User, ...r: Role[]) => u.roles.some(role => r.includes(role));
export const admin = (u: User) => has(u, "super_admin", "admin");
export const author = (u: User) => has(u, "super_admin", "admin", "author");
export const auditReader = (u: User) => has(u, "super_admin", "admin", "auditor");
export function demand(ok: unknown, message = "You do not have permission for this action", status = 403): asserts ok { if (!ok) throw new HttpError(status, message); }
export function fail(error: unknown) {
  const stale=error instanceof Error && /Stale document revision/.test(error.message);
  console.error(error instanceof HttpError ? error.message : error);
  return Response.json({error:stale?"The document changed in another session. Refresh before trying again":error instanceof HttpError?error.message:"The request could not be completed. No approval was recorded. Check the server log."},{status:stale?409:error instanceof HttpError?error.status:500,headers:{"cache-control":"no-store"}});
}
export function publicUser(row: Record<string, unknown>): User { return { id: String(row.id), username: String(row.username), name: String(row.name), email: String(row.email || ""), roles: JSON.parse(String(row.roles)), active: Number(row.active), must_change: Number(row.must_change) }; }
export function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  demand(password.length >= 12 && password.length <= 128, "Use a password of 12–128 characters", 400);
  return `pbkdf2-sha256$600000$${salt}$${pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex")}`;
}
export function passwordMatches(password: string, stored: string) {
  const [algorithm, iterations, salt, expected] = stored.split("$");
  if (algorithm !== "pbkdf2-sha256" || iterations !== "600000" || !salt || !expected || password.length > 128) return false;
  const actual = pbkdf2Sync(password, salt, 600000, 32, "sha256");
  const digest = Buffer.from(expected, "hex");
  return digest.length === actual.length && timingSafeEqual(actual, digest);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url); // Nginx preserves the externally supplied host and port.
  demand(origin && new URL(origin).host === expected.host && new URL(origin).protocol === expected.protocol, "Refresh the page and sign in again (origin check failed)");
}
export const tokenFrom = (request: Request) => request.headers.get("cookie")?.match(/(?:^|;\s*)ff_session=([^;]+)/)?.[1] || "";
export function cookie(request: Request, token: string, expires = 28800) { return `ff_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expires}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`; }
export async function requireUser(request: Request, allowChange = false) {
  const token = tokenFrom(request);
  demand(token, "Sign in to continue", 401);
  const row = await db().prepare(`SELECT u.* FROM ac_users u JOIN ac_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>? AND u.active=1`).bind(sha(token), now(), new Date(Date.now() - 30 * 60 * 1000).toISOString()).first<Record<string, unknown>>();
  demand(row, "Your session expired. Sign in again", 401);
  const user = publicUser(row);
  demand(allowChange || !user.must_change, "Change your temporary password before continuing", 428);
  if(new URL(request.url).searchParams.get("poll")!=="1") await db().prepare("UPDATE ac_sessions SET last_seen=? WHERE token_hash=?").bind(now(), sha(token)).run();
  return user;
}
export function event(u: User | null, action: string, entity = "", detail: unknown = {}) {
  return db().prepare("INSERT INTO ac_audit(id,at,user_id,actor,roles,action,entity_id,detail) VALUES(?,?,?,?,?,?,?,?)").bind(uuid(), now(), u?.id || "", u?.name || "Unauthenticated", JSON.stringify(u?.roles || []), action, entity, JSON.stringify(detail));
}
export function notification(userId: string | null, entity: string, message: string) {
  return db().prepare("INSERT INTO ac_notifications(id,user_id,entity_id,message,at) VALUES(?,?,?,?,?)").bind(uuid(), userId || "", entity, message, now());
}
export async function userById(id: string) {
  const row = await db().prepare("SELECT * FROM ac_users WHERE id=? AND active=1").bind(id).first<Record<string, unknown>>();
  demand(row, "Choose an active user", 400); return publicUser(row);
}
export async function flow(id: string) { const f = await db().prepare("SELECT * FROM ac_workflows WHERE template_id=?").bind(id).first<Flow>(); demand(f, "Document is not assigned. Ask an administrator to assign it", 404); return f; }
export function canRead(u: User, f: Flow) { return admin(u) || (has(u,"auditor") && ["Approved","Superseded","Archived"].includes(f.status)) || [f.author_id, f.reviewer_id, f.approver_id].includes(u.id); }
export function canEdit(u: User, f: Flow) { return author(u) && f.author_id === u.id && ["Draft", "Changes Requested"].includes(f.status); }
export async function documentAccess(u: User, id: string) {
  const existing=await db().prepare("SELECT * FROM ac_workflows WHERE template_id=?").bind(id).first<Flow>();
  if(!existing){demand(admin(u));const row=await loadTemplate(id);demand(parseTemplate(row).documentMeta.outputStyle==="controlled-document","Not a controlled document",400);return {template_id:id,author_id:"",reviewer_id:null,approver_id:null,status:"Unassigned legacy",revision:0,round:0,updated_at:row.updated_at} as Flow;}
  demand(canRead(u,existing));return existing;
}
export async function formAccess(u: User, id: string, write = false) {
  const owner = await db().prepare("SELECT user_id FROM ac_ownership WHERE kind='submission' AND entity_id=?").bind(id).first<{user_id:string}>();
  demand((write ? admin(u) : auditReader(u)) || owner?.user_id === u.id);
  if (write) demand(author(u), "This is a read-only account");
}
// Compare-and-swap followed by a SQL CHECK: a stale decision aborts the entire D1 batch.
export function guard(f: Flow) { return [
  db().prepare("UPDATE ac_workflows SET revision=revision+1,updated_at=? WHERE template_id=? AND revision=?").bind(now(), f.template_id, f.revision),
  db().prepare("INSERT INTO ac_assert(value) VALUES(changes())"), db().prepare("DELETE FROM ac_assert"),
]; }
export function snapshot(u: User, row: TemplateRow, action: string) { const content = JSON.stringify(parseTemplate(row)); return db().prepare("INSERT INTO ac_snapshots(id,template_id,at,user_id,action,content,sha256) VALUES(?,?,?,?,?,?,?)").bind(uuid(), row.id, now(), u.id, action, content, sha(content)); }
export async function loadTemplate(id: string) { const row = await db().prepare("SELECT * FROM templates WHERE id=?").bind(id).first<TemplateRow>(); demand(row, "Document not found", 404); return row; }
export async function approvedFile(id: string, format: string) {
  const parts = await db().prepare("SELECT bytes FROM ac_files WHERE template_id=? AND format=? ORDER BY part").bind(id, format).all<{bytes:ArrayBuffer|number[]}>();
  demand(parts.results.length, "The frozen approved file is unavailable. Ask an administrator to inspect the backup", 409);
  const bytes=Buffer.concat(parts.results.map(p => Buffer.from(p.bytes as ArrayBuffer)));
  const approval=await db().prepare("SELECT pdf_hash,docx_hash FROM ac_approvals WHERE template_id=?").bind(id).first<{pdf_hash:string;docx_hash:string}>();
  demand(approval && sha(bytes)===(format==="pdf"?approval.pdf_hash:approval.docx_hash),"Approved file integrity check failed; contact the VM administrator",409);
  return bytes;
}
