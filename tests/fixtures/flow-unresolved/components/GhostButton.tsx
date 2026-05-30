export function GhostButton() {
  async function callGhost() {
    await fetch("/api/ghost", { method: "GET" });
  }
  return <button onClick={callGhost}>Ghost</button>;
}
