// Order fetching helper — called by GET /api/orders route.
export async function fetchOrders(): Promise<{ id: string; status: string }[]> {
  return [{ id: "ord-1", status: "shipped" }];
}
