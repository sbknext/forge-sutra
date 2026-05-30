// Next.js App Router route — GET /api/ping is properly defined AND has a matching client fetch.
// This is the VALID pair: scanner should see both sides, runChecks must NOT flag it.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ pong: true });
}
