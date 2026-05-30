export async function fetchGreet() {
  const res = await fetch("/api/greet", { method: "GET" });
  return res.json();
}
