// Next.js App Router route — only GET is handled here.
// POST /api/capture is intentionally MISSING → triggers orphaned_endpoint on the client side.
import { NextResponse } from "next/server";
import { captureHandler } from "../../../lib/nonexistent-handler.js"; // does not exist → missing_handler

export async function GET() {
  return NextResponse.json({ ok: true });
}
// NOTE: no POST export here — client fetch below will find no matching route.
