// Helper used by the route above. Exists on disk → no dangling import.
export function buildGreeting(name: string): string {
  return `Hello, ${name}!`;
}
