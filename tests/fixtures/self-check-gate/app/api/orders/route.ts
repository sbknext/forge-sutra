// Next.js App Router route — GET /api/orders is fully defined.
// Client fetch and this handler are aligned → zero issues expected.
import { NextResponse } from "next/server";
import { fetchOrders } from "../../../lib/orders.js";

export async function GET() {
  const orders = await fetchOrders();
  return NextResponse.json({ orders });
}
