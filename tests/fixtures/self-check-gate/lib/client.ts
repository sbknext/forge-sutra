// Matching client fetch for GET /api/orders — fully wired, no issues.
export async function getOrders() {
  const res = await fetch("/api/orders", { method: "GET" });
  return res.json() as Promise<{ orders: { id: string; status: string }[] }>;
}
