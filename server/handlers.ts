import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { board } from "../src/lib/chess.ts";
import { baseSchema, coachSchema, assertCoachAccess } from "./contracts.ts";
import { makeOpponent, makeCoach } from "./agents.ts";
import { models, model } from "./models.ts";
import {
  unlocked,
  sameOrigin,
  limit,
  passwordMatches,
  setSession,
  hosted,
} from "./security.ts";
export async function handle(
  kind: "config" | "session" | "coach" | "opponent",
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (kind === "config") {
      if (req.method !== "GET")
        return res.status(405).json({ error: "Method not allowed" });
      return res.json({
        unlocked: unlocked(req),
        passwordRequired: Boolean(process.env.APP_PASSWORD) || hosted(),
        models: models(),
      });
    }
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
    if (!sameOrigin(req))
      return res.status(403).json({ error: "Origin not allowed" });
    if (JSON.stringify(req.body || {}).length > 150000)
      return res.status(413).json({ error: "Request too large" });
    if (kind === "session") {
      limit(req, "unlock", 8);
      const { password } = z
        .object({ password: z.string().max(500) })
        .parse(req.body);
      if (!passwordMatches(password))
        return res
          .status(401)
          .json({
            error: "Incorrect password, or APP_PASSWORD is not configured.",
          });
      setSession(res);
      return res.json({ ok: true });
    }
    if (!unlocked(req))
      return res
        .status(401)
        .json({
          error: "Unlock AI in Settings. Hosted AI requires APP_PASSWORD.",
        });
    limit(req, "ai", 20);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 55000);
    res.on("close", () => abort.abort());
    try {
      if (kind === "opponent") {
        const data = baseSchema.parse(req.body);
        const b = board(data.game);
        let selected = "";
        const agent = makeOpponent(data, model(data.provider), (m) => {
          selected = m;
        });
        const output = await agent.generate({
          prompt: `Choose your move. Position: ${b.fen()}. Game moves: ${b.history().join(" ")}`,
          abortSignal: abort.signal,
        });
        if (!selected)
          throw Error("The model did not select a legal move. Please retry.");
        return res.json({
          move: selected,
          fen: b.fen(),
          gameId: data.game.id,
          ply: data.game.moves.length,
          usage: output.totalUsage,
        });
      }
      const data = coachSchema.parse(req.body);
      assertCoachAccess(data.game);
      const send = (event: unknown) => {
        if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
      };
      const agent = makeCoach(data, model(data.provider), (line) =>
        send({ type: "line", line }),
      );
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("X-Accel-Buffering", "no");
      try {
        const output = await agent.stream({
          messages: data.messages,
          abortSignal: abort.signal,
        });
        for await (const part of output.textStream)
          send({ type: "text", text: part });
        send({ type: "usage", usage: await output.totalUsage });
        send({ type: "done" });
      } catch (e) {
        send({
          type: "error",
          error: e instanceof Error ? e.message : "AI request failed",
        });
      }
      res.end();
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const error =
      e instanceof z.ZodError
        ? "Invalid request data."
        : e instanceof Error
          ? e.message
          : "Request failed";
    if (!res.headersSent)
      res.status(error.includes("Too many") ? 429 : 400).json({ error });
    else res.end();
  }
}
