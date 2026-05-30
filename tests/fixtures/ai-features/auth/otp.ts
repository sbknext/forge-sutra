export async function verifyOtp(code: string) {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return res.json();
}
