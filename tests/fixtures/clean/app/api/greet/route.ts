// Next.js App Router route — GET /api/greet is fully defined.
// Client fetch and this handler are aligned → zero issues expected.
import { NextResponse } from "next/server";
import { buildGreeting } from "../../../lib/greeter.js"; // exists below → no missing_handler

export async function GET() {
  const msg = buildGreeting("world");
  return NextResponse.json({ message: msg });
}
