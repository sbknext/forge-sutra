export function LoginForm() {
  async function sendOtp() {
    await fetch("/api/auth/otp", { method: "POST" });
  }
  return <button onClick={sendOtp}>Login</button>;
}
