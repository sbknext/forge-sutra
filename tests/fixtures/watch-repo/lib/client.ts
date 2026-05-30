/** Minimal repo for watch-mode tests. */
export function ping() {
  return fetch("/api/ping");
}
