export function WidgetButton() {
  async function submit() {
    await fetch("/api/widget", { method: "POST" });
  }
  return <button onClick={submit}>Widget</button>;
}
