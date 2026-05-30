/**
 * Minimal LLM provider shim — env-keyed, injectable for tests.
 */

export interface LlmProvider {
  isAvailable(): boolean;
  complete(prompt: string): Promise<string>;
}

let injected: LlmProvider | null = null;

/** Test hook — inject a fake provider (null restores default). */
export function setLlmProvider(provider: LlmProvider | null): void {
  injected = provider;
}

export function isLlmAvailable(): boolean {
  if (injected) return injected.isAvailable();
  const key = process.env.SUTRA_AI_API_KEY?.trim();
  return Boolean(key && key.length > 0);
}

export async function complete(prompt: string): Promise<string> {
  if (injected) {
    return injected.complete(prompt);
  }
  const key = process.env.SUTRA_AI_API_KEY?.trim();
  if (!key) {
    throw new Error("SUTRA_AI_API_KEY not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.SUTRA_AI_MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty LLM response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
