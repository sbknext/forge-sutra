// External Telegram Bot API call — must NOT trigger orphaned_endpoint.
export async function sendTelegramAlert(token: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: "123", text }),
  });
}
