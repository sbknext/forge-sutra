import { listSessions } from "./sessions.js";

export function SessionList() {
  async function load() {
    await listSessions();
  }
  return <ul onClick={load} />;
}
