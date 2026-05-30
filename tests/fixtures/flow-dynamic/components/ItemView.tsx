import { fetchItem } from "../lib/client.js";

export function ItemView({ id }: { id: string }) {
  async function load() {
    await fetchItem(id);
  }
  return <button onClick={load}>Load</button>;
}
