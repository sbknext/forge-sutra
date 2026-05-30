// Client that fetches proxied routes — should NOT trigger orphaned_endpoint
// because next.config.js rewrites '/api/:path*' to an external server.

export async function fetchData() {
  const res = await fetch('/api/whatever');
  return res.json();
}

export async function postData(body: unknown) {
  const res = await fetch('/api/capture', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function login(credentials: unknown) {
  const res = await fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  return res.json();
}
