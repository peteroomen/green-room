import type { Config } from "./types";
export async function post(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw Error(d.error || "The AI connection failed. Try again.");
  }
  return res;
}
export async function getConfig(): Promise<Config> {
  const res = await fetch("/api/config");
  if (!res.ok) throw Error("Could not reach AI configuration");
  return res.json();
}
export async function streamCoach(
  body: unknown,
  signal: AbortSignal,
  onEvent: (e: {
    type: string;
    text?: string;
    line?: string[];
    error?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }) => void,
) {
  const res = await post("coach", body, signal);
  if (!res.body) throw Error("No streaming response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (!raw.trim()) continue;
        const e = JSON.parse(raw);
        if (e.type === "error") throw Error(e.error);
        if (e.type === "done") done = true;
        onEvent(e);
      }
      if (part.done) break;
    }
    if (!done) throw Error("The response ended early. Please retry.");
  } finally {
    reader.releaseLock();
  }
}
