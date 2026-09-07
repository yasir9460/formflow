import { db } from "../../../lib/form-store";
export async function GET(){try{await db().prepare("SELECT 1 FROM ac_users LIMIT 1").first();return Response.json({ok:true,version:"0.5.0"},{headers:{"cache-control":"no-store"}});}catch{return Response.json({ok:false},{status:503});}}
