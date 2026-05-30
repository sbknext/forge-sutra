export async function fetchItem(id: string) {
  const res = await fetch(`/api/item/${id}`, { method: "GET" });
  return res.json();
}
