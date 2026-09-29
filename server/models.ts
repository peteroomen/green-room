import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Provider } from "../src/lib/types.ts";
export function models() {
  return [
    {
      id: "claude" as const,
      name: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      ready: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    {
      id: "openai" as const,
      name: process.env.OPENAI_MODEL || "OpenAI",
      ready: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    },
    {
      id: "google" as const,
      name: process.env.GOOGLE_MODEL || "Gemini",
      ready: Boolean(
        process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_MODEL,
      ),
    },
  ];
}
export function model(id: Provider) {
  if (!models().find((m) => m.id === id)?.ready)
    throw Error("This model is not configured. Add its API key in Vercel.");
  if (id === "claude")
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    );
  if (id === "openai")
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(
      process.env.OPENAI_MODEL!,
    );
  return createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  })(process.env.GOOGLE_MODEL!);
}
