// Matching client fetch for GET /api/greet — fully wired, no issues.
export async function fetchGreeting() {
  const res = await fetch("/api/greet", { method: "GET" });
  return res.json() as Promise<{ message: string }>;
}
