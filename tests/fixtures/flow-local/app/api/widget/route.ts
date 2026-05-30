import { query } from "../../../lib/db.js";

export async function POST() {
  await query("SELECT 1");
  return Response.json({ ok: true });
}
