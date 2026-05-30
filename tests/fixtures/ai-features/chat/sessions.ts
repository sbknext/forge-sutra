export async function listSessions() {
  const res = await fetch("/api/chat/sessions", { method: "GET" });
  return res.json();
}
