// Next.js App Router — POST /api/data/search
// This local handler exists AND /api/:path* is proxied in next.config.js.
// Local handlers take precedence over rewrites — flows.ts must resolve this
// as a local "confirmed" hop, NOT mark it "unresolved".
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json() as { query?: string };
  return NextResponse.json({ hits: [], query: body.query ?? "" });
}
