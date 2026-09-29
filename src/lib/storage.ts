import { z } from "zod";
import { board, legalLine, newGame } from "./chess";
import { defaults, type State, type Card } from "./types";
export const STORAGE_KEY = "greenroom-v1";
const uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export const settingsSchema = z.object({
  rating: z.number().min(100).max(3000),
  difficulty: z.number().int().min(0).max(5),
  side: z.enum(["w", "b"]),
  provider: z.enum(["claude", "openai", "google"]),
  timing: z.enum(["request", "before", "after"]),
  frequency: z.enum(["critical", "occasional", "every"]),
  detail: z.number().int().min(1).max(5),
  level: z.enum(["plain", "standard", "advanced"]),
  analysisMs: z.number().min(100).max(3000),
  showEval: z.boolean(),
  dailyLimit: z.number().int().min(1).max(200),
});
const schema = z.object({
  version: z.literal(1),
  current: z.string(),
  settings: settingsSchema,
  games: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().max(200),
        initialFen: z.string(),
        moves: z.array(uci).max(800),
        player: z.enum(["w", "b"]),
        opponent: z.enum(["stockfish", "llm", "local"]),
        difficulty: z.number().int().min(0).max(5),
        provider: z.enum(["claude", "openai", "google"]),
        createdAt: z.number(),
        result: z.enum(["1-0", "0-1", "1/2-1/2"]).optional(),
      }),
    )
    .max(2000),
  chats: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        fen: z.string().optional(),
        line: z.array(uci).optional(),
      }),
    ),
  ),
  cards: z
    .array(
      z.object({
        id: z.string(),
        fen: z.string(),
        solution: uci,
        line: z.array(uci),
        source: z.string(),
        themes: z.array(z.string()),
        due: z.number(),
        interval: z.number().min(0),
        lapses: z.number().min(0),
      }),
    )
    .max(5000),
  attempts: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["puzzle", "card"]),
        themes: z.array(z.string()),
        success: z.boolean(),
        assisted: z.boolean(),
        at: z.number(),
      }),
    )
    .max(50000),
  usage: z.object({
    date: z.string(),
    calls: z.number(),
    input: z.number(),
    output: z.number(),
  }),
});
export function today() {
  return new Date().toLocaleDateString("en-CA");
}
export function emptyState(): State {
  const g = newGame();
  return {
    version: 1,
    current: g.id,
    games: [g],
    settings: { ...defaults },
    chats: {},
    cards: [],
    attempts: [],
    usage: { date: today(), calls: 0, input: 0, output: 0 },
  };
}
export function parseBackup(text: string): State {
  if (text.length > 15000000) throw Error("Backup exceeds 15 MB");
  const s = schema.parse(JSON.parse(text)) as State;
  for (const g of s.games) board(g);
  for (const c of s.cards)
    if (!legalLine(c.fen, [c.solution]) || !legalLine(c.fen, c.line))
      throw Error("Invalid practice position");
  for (const chat of Object.values(s.chats))
    for (const m of chat)
      if (m.line && (!m.fen || !legalLine(m.fen, m.line))) m.line = undefined;
  if (!s.games.length) {
    const g = newGame(s.settings);
    s.games = [g];
  }
  if (!s.games.some((g) => g.id === s.current)) s.current = s.games[0].id;
  return s;
}
export function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? parseBackup(raw) : emptyState();
}
export function save(s: State) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function schedule(c: Card, success: boolean): Card {
  const interval = success
    ? c.interval
      ? Math.min(c.interval * 2.3, 90)
      : 1
    : 0;
  return {
    ...c,
    interval,
    lapses: c.lapses + (success ? 0 : 1),
    due: Date.now() + (success ? interval * 86400000 : 600000),
  };
}
