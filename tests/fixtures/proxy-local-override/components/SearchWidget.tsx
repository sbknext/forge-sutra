// Client component that calls /api/data/search — a route that exists locally
// (app/api/data/search/route.ts) AND is covered by the wildcard proxy in
// next.config.js (/api/:path* → http://localhost:4000/...).
// Next.js App Router: local handlers always take precedence over rewrites.
// Sutra must resolve this to the local handler, NOT mark the flow "unresolved".

export function SearchWidget() {
  async function search(q: string) {
    const res = await fetch("/api/data/search", {
      method: "POST",
      body: JSON.stringify({ query: q }),
    });
    return res.json();
  }
  return <button onClick={() => search("test")}>Search</button>;
}
