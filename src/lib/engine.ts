import { Chess, board, legalLine } from "./chess";
import { difficulties, type Analysis, type Game } from "./types";
/** A serialized UCI worker. Every request re-establishes options and position. */
class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(s: string) => void>();
  private cache = new Map<string, Analysis>();
  private send(s: string) {
    this.worker!.postMessage(s);
  }
  private wait(test: (s: string) => boolean, ms = 20000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(fn);
        reject(Error("Stockfish timed out. Please retry."));
      }, ms);
      const fn = (s: string) => {
        if (test(s)) {
          clearTimeout(timer);
          this.listeners.delete(fn);
          resolve(s);
        }
      };
      this.listeners.add(fn);
    });
  }
  private async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.worker = new Worker("/engine/stockfish.js");
      this.worker.onmessage = (e) => {
        for (const line of String(e.data).split("\n"))
          for (const f of this.listeners) f(line);
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.ready = null;
      };
      let ack = this.wait((s) => s === "uciok");
      this.send("uci");
      await ack;
      this.send("setoption name Hash value 32");
      ack = this.wait((s) => s === "readyok");
      this.send("isready");
      await ack;
    })();
    try {
      await this.ready;
    } catch (e) {
      this.reset();
      throw e;
    }
  }
  private reset() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.listeners.clear();
  }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(fn);
    this.queue = result;
    return result;
  }
  private async search(
    fen: string,
    ms: number,
    multi: number,
    skill: number,
    signal?: AbortSignal,
    history?: Pick<Game, "initialFen" | "moves">,
  ): Promise<Analysis> {
    signal?.throwIfAborted();
    await this.init();
    signal?.throwIfAborted();
    const color = new Chess(fen).turn() === "w" ? 1 : -1;
    const lines = new Map<number, Analysis["lines"][number]>();
    this.send(`setoption name Skill Level value ${skill}`);
    this.send(`setoption name MultiPV value ${multi}`);
    this.send("setoption name UCI_LimitStrength value false");
    this.send(
      history
        ? `position fen ${history.initialFen}${history.moves.length ? " moves " + history.moves.join(" ") : ""}`
        : `position fen ${fen}`,
    );
    const onInfo = (s: string) => {
      const score = s.match(/score (cp|mate) (-?\d+)/);
      const pv = s.match(/ pv (.+)$/);
      if (!score || !pv || s.includes("bound")) return;
      const sequence = pv[1].trim().split(" ");
      if (!legalLine(fen, sequence)) return;
      const mate = score[1] === "mate" ? Number(score[2]) * color : undefined;
      lines.set(Number(s.match(/multipv (\d+)/)?.[1] || 1), {
        move: sequence[0],
        pv: sequence,
        cp:
          mate !== undefined
            ? (Math.sign(mate) || color) * 100000
            : Number(score[2]) * color,
        mate,
        depth: Number(s.match(/depth (\d+)/)?.[1] || 0),
      });
    };
    this.listeners.add(onInfo);
    const stop = () => this.send("stop");
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const done = this.wait((s) => s.startsWith("bestmove "), ms + 15000);
      this.send(`go movetime ${ms}`);
      const best = (await done).split(" ")[1];
      signal?.throwIfAborted();
      const values = [...lines.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((x) => x[1]);
      if (skill < 20 && best && legalLine(fen, [best])) {
        return {
          fen,
          lines: [
            {
              move: best,
              pv: [best],
              cp: values[0]?.cp || 0,
              depth: values[0]?.depth || 0,
            },
          ],
        };
      }
      return { fen, lines: values };
    } catch (e) {
      if (!signal?.aborted) this.reset();
      throw e;
    } finally {
      this.listeners.delete(onInfo);
      signal?.removeEventListener("abort", stop);
    }
  }
  analyze(fen: string, ms = 450, multi = 3, signal?: AbortSignal) {
    return this.run(async () => {
      signal?.throwIfAborted();
      const key = `${fen}:${ms}:${multi}`;
      const hit = this.cache.get(key);
      if (hit) return hit;
      const a = await this.search(fen, ms, multi, 20, signal);
      this.cache.set(key, a);
      if (this.cache.size > 400)
        this.cache.delete(this.cache.keys().next().value!);
      return a;
    });
  }
  play(game: Game, signal?: AbortSignal) {
    return this.run(async () => {
      const d = difficulties[game.difficulty];
      const a = await this.search(
        board(game).fen(),
        d.ms,
        1,
        d.skill,
        signal,
        game,
      );
      if (!a.lines[0]) throw Error("No legal engine move returned");
      return a.lines[0].move;
    });
  }
}
export const engine = new Engine();
export function evalText(a: Analysis["lines"][number]) {
  return a.mate !== undefined
    ? `M${a.mate}`
    : `${a.cp >= 0 ? "+" : ""}${(a.cp / 100).toFixed(1)}`;
}
