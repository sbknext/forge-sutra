// Calls collection path — no matching [id] route for GET /api/todos alone
export async function fetchAllTodos() {
  const res = await fetch("/api/todos", { method: "GET" });
  return res.json();
}
