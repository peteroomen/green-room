import { Chess, DEFAULT_POSITION, type Move } from "chess.js";
import { defaults, type Game, type Settings } from "./types.ts";
export { Chess, DEFAULT_POSITION };
export function uid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
}
export function uci(m: Move) {
  return m.from + m.to + (m.promotion || "");
}
export function move(b: Chess, v: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v))
    throw Error("Invalid move format");
  return b.move({ from: v.slice(0, 2), to: v.slice(2, 4), promotion: v[4] });
}
export function board(
  g: Pick<Game, "initialFen" | "moves">,
  ply = g.moves.length,
) {
  const b = new Chess(g.initialFen);
  for (const m of g.moves.slice(0, ply)) move(b, m);
  return b;
}
export function legalLine(fen: string, line: string[]) {
  try {
    const b = new Chess(fen);
    for (const m of line) move(b, m);
    return true;
  } catch {
    return false;
  }
}
export function sanLine(fen: string, line: string[]) {
  const b = new Chess(fen);
  const out: string[] = [];
  for (const m of line) {
    try {
      out.push(move(b, m).san);
    } catch {
      break;
    }
  }
  return out;
}
export function result(b: Chess) {
  return b.isCheckmate()
    ? b.turn() === "w"
      ? "0-1"
      : "1-0"
    : b.isGameOver()
      ? "1/2-1/2"
      : undefined;
}
export function status(b: Chess) {
  return b.isCheckmate()
    ? "Checkmate"
    : b.isStalemate()
      ? "Stalemate"
      : b.isDraw()
        ? "Draw"
        : `${b.turn() === "w" ? "White" : "Black"} to move${b.isCheck() ? " · check" : ""}`;
}
export function newGame(
  s: Settings = defaults,
  opponent: Game["opponent"] = "stockfish",
  fen = DEFAULT_POSITION,
): Game {
  return {
    id: uid(),
    title:
      opponent === "local"
        ? "Analysis board"
        : `You vs ${opponent === "stockfish" ? "Stockfish" : s.provider === "claude" ? "Claude" : s.provider}`,
    initialFen: fen,
    moves: [],
    player: s.side,
    opponent,
    difficulty: s.difficulty,
    provider: s.provider,
    createdAt: Date.now(),
    result: result(new Chess(fen)),
  };
}
export function commit(
  g: Game,
  m: string,
  expectedFen: string,
  ply: number,
): Game {
  const b = board(g);
  if (g.result || g.moves.length !== ply || b.fen() !== expectedFen)
    throw Error("The position changed. Try again.");
  move(b, m);
  return { ...g, moves: [...g.moves, m], result: result(b), review: undefined };
}
export function exportPgn(g: Game) {
  const b = board(g);
  b.setHeader("Event", "Greenroom");
  b.setHeader("White", g.player === "w" ? "You" : g.opponent);
  b.setHeader("Black", g.player === "b" ? "You" : g.opponent);
  b.setHeader("Result", g.result || "*");
  return b.pgn();
}
export function importPgn(text: string, s: Settings) {
  const b = new Chess();
  b.loadPgn(text);
  const history = b.history({ verbose: true });
  const g = newGame(s, "local", history[0]?.before || b.fen());
  return {
    ...g,
    title: b.getHeaders().Event || "Imported game",
    moves: history.map(uci),
    result:
      result(b) ||
      (b.getHeaders().Result !== "*" ? b.getHeaders().Result : undefined),
  };
}
export function describe(fen: string) {
  const b = new Chess(fen);
  return {
    fen,
    turn: b.turn(),
    check: b.isCheck(),
    status: status(b),
    pieces: b
      .board()
      .flat()
      .filter(Boolean)
      .map((p) => `${p!.color}${p!.type}@${p!.square}`),
    legalMoves: b
      .moves({ verbose: true })
      .map((m) => ({ uci: uci(m), san: m.san })),
  };
}
export function themeNames(fen: string, m: string) {
  const b = new Chess(fen);
  const played = move(b, m);
  return [
    ...(played.san.includes("#")
      ? ["mate"]
      : played.san.includes("+")
        ? ["check"]
        : []),
    ...(played.captured ? ["capture"] : []),
    ...(played.promotion ? ["promotion"] : []),
    "calculation",
  ];
}
