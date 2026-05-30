// Client-side fetch calls used to test orphaned_endpoint detection.

// BAD: POST /api/capture — no route defines POST for this path → orphaned_endpoint
export async function submitCapture(data: unknown) {
  const res = await fetch("/api/capture", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.json();
}

// GOOD: GET /api/ping — route.ts above exports GET → no issue expected
export async function pingServer() {
  const res = await fetch("/api/ping", { method: "GET" });
  return res.json();
}
