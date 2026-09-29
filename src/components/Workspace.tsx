import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  Plus,
  RotateCw,
  RotateCcw,
  Download,
  Flag,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Lightbulb,
  ScanSearch,
  Play,
  Bookmark,
  Leaf,
  Castle,
  UserRound,
  X,
  BookOpen,
} from "lucide-react";
import { Board } from "./Board";
import { Chat } from "./Chat";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Busy, Empty, IconButton } from "./common";
import {
  board,
  Chess,
  commit,
  exportPgn,
  move,
  newGame,
  sanLine,
  status,
  themeNames,
  uid,
} from "@/lib/chess";
import { engine, evalText } from "@/lib/engine";
import { loss, reviewGame } from "@/lib/review";
import { download } from "@/lib/storage";
import { post } from "@/lib/api";
import {
  difficulties,
  type Analysis,
  type Game,
  type Page,
  type ReviewMove,
  type State,
} from "@/lib/types";
import type { Config } from "@/lib/types";
export function Workspace({
  state,
  setState,
  page,
  onPage,
  onNew,
  config,
  onCall,
  onUsage,
}: {
  state: State;
  setState: Dispatch<SetStateAction<State>>;
  page: "play" | "review";
  onPage: (p: Page) => void;
  onNew: () => void;
  config: Config;
  onCall: () => boolean;
  onUsage: (u: { inputTokens?: number; outputTokens?: number }) => void;
}) {
  const game = state.games.find((g) => g.id === state.current)!;
  const settings = state.settings;
  const live = board(game);
  const activeLLM = game.opponent === "llm" && !game.result;
  const review = page === "review";
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState("coach");
  const [branch, setBranch] = useState<{
    fen: string;
    moves: string[];
    cursor: number;
  } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [coachTick, setCoachTick] = useState(0);
  const [reviewProgress, setReviewProgress] = useState<number | null>(null);
  const [resign, setResign] = useState(false);
  const [pending, setPending] = useState<{
    move: string;
    fen: string;
    ply: number;
    loss: number;
  } | null>(null);
  const [prompt, setPrompt] = useState<{ id: string; text: string }>();
  const [evidence, setEvidence] = useState<Analysis[]>([]);
  const abort = useRef<AbortController | null>(null);
  const reviewAbort = useRef<AbortController | null>(null);
  const checkAbort = useRef<AbortController | null>(null);
  const current = useRef(game);
  current.current = game;
  const coachingNext = useRef<{
    gameId: string;
    text: string;
    evidence: Analysis[];
  } | null>(null);
  const selected = branch
    ? board({
        initialFen: branch.fen,
        moves: branch.moves.slice(0, branch.cursor),
      })
    : review
      ? board(game, Math.min(ply, game.moves.length))
      : live;
  const fen = selected.fen();
  const row = game.review?.find((r) => r.ply === ply);
  const supplied = row ? [row.before, row.after] : evidence;
  useEffect(() => {
    abort.current?.abort();
    reviewAbort.current?.abort();
    checkAbort.current?.abort();
    setBranch(null);
    setAnalysis(null);
    setPly(0);
    setError("");
    setBusy(false);
    setPending(null);
    setReviewProgress(null);
    coachingNext.current = null;
    return () => {
      abort.current?.abort();
      reviewAbort.current?.abort();
      checkAbort.current?.abort();
    };
  }, [game.id]);
  useEffect(() => {
    setBranch(null);
    setAnalysis(null);
    setTab(review ? "review" : "coach");
    if (review) {
      abort.current?.abort();
      checkAbort.current?.abort();
      setBusy(false);
    }
  }, [page]);
  useEffect(() => {
    if (
      review ||
      branch ||
      game.result ||
      game.opponent === "local" ||
      live.turn() === game.player
    )
      return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    const expected = live.fen();
    const source = game;
    (async () => {
      try {
        let m: string;
        if (source.opponent === "stockfish")
          m = await engine.play(source, controller.signal);
        else {
          if (
            !config.unlocked ||
            !config.models.find((m) => m.id === source.provider)?.ready
          )
            throw Error(
              "Connect this AI model in Settings, then retry its turn.",
            );
          if (!onCall())
            throw Error("Daily AI call limit reached. Adjust it in Settings.");
          const data = await (
            await post(
              "opponent",
              { game: source, provider: source.provider },
              controller.signal,
            )
          ).json();
          if (
            data.gameId !== source.id ||
            data.ply !== source.moves.length ||
            data.fen !== expected
          )
            throw Error("Outdated opponent response. Retry.");
          m = data.move;
          onUsage(data.usage || {});
        }
        if (controller.signal.aborted) return;
        apply(m, expected, source.moves.length, source.id);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Opponent unavailable");
      } finally {
        if (abort.current === controller) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [
    game.id,
    game.moves.length,
    game.result,
    review,
    Boolean(branch),
    retry,
    config.unlocked,
  ]);
  useEffect(() => {
    if (
      !busy &&
      coachingNext.current &&
      coachingNext.current.gameId === game.id &&
      live.turn() === game.player
    ) {
      const next = coachingNext.current;
      coachingNext.current = null;
      setEvidence(next.evidence);
      setPrompt({ id: uid(), text: next.text });
      setTab("coach");
    }
  }, [busy, game.moves.length, coachTick]);
  function apply(
    m: string,
    expected = live.fen(),
    at = game.moves.length,
    id = game.id,
  ) {
    setState((s) => ({
      ...s,
      games: s.games.map((g) => {
        if (g.id !== id) return g;
        try {
          return commit(g, m, expected, at);
        } catch {
          return g;
        }
      }),
    }));
  }
  async function userMove(m: string) {
    if (branch) {
      try {
        const b = new Chess(fen);
        move(b, m);
        setBranch({
          ...branch,
          moves: [...branch.moves.slice(0, branch.cursor), m],
          cursor: branch.cursor + 1,
        });
      } catch {
        toast.error("That move is not legal.");
      }
      return;
    }
    if (review) {
      setBranch({ fen, moves: [m], cursor: 1 });
      return;
    }
    if (busy || game.result) return;
    const expected = live.fen(),
      at = game.moves.length;
    const controller = new AbortController();
    checkAbort.current = controller;
    const source = game;
    try {
      if (
        settings.timing === "before" &&
        game.opponent !== "llm" &&
        game.opponent !== "local"
      ) {
        setBusy(true);
        const before = await engine.analyze(
          expected,
          settings.analysisMs,
          3,
          controller.signal,
        );
        const b = new Chess(expected);
        move(b, m);
        const after = await engine.analyze(
          b.fen(),
          settings.analysisMs,
          1,
          controller.signal,
        );
        const delta = loss(before, after, live.turn());
        if (
          current.current.id !== source.id ||
          board(current.current).fen() !== expected
        )
          return;
        if (delta >= 120 || settings.frequency === "every") {
          setPending({ move: m, fen: expected, ply: at, loss: delta });
          return;
        }
      }
      apply(m, expected, at);
      if (settings.timing === "after" && source.opponent === "stockfish") {
        const before = await engine.analyze(
          expected,
          settings.analysisMs,
          3,
          controller.signal,
        );
        const b = new Chess(expected);
        const made = move(b, m);
        const after = await engine.analyze(
          b.fen(),
          settings.analysisMs,
          3,
          controller.signal,
        );
        if (current.current.id !== source.id || controller.signal.aborted)
          return;
        const delta = loss(before, after, source.player);
        if (
          settings.frequency === "every" ||
          delta >= 120 ||
          (settings.frequency === "occasional" && at % 6 === 0)
        ) {
          coachingNext.current = {
            gameId: source.id,
            text: `Give gentle feedback on my ${made.san}, played from ${expected}. ${delta >= 120 ? "Help me notice what I missed." : "Focus on one useful idea."}`,
            evidence: [before, after],
          };
          setCoachTick((x) => x + 1);
        }
      }
    } catch (e) {
      if (!controller.signal.aborted)
        toast.error(
          e instanceof Error ? e.message : "Move could not be checked",
        );
    } finally {
      if (checkAbort.current === controller) setBusy(false);
    }
  }
  async function analyse() {
    if (activeLLM) return;
    const target = fen;
    setAnalysing(true);
    try {
      setAnalysis(await engine.analyze(target, settings.analysisMs, 3));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAnalysing(false);
    }
  }
  async function runReview() {
    reviewAbort.current?.abort();
    const c = new AbortController();
    reviewAbort.current = c;
    setReviewProgress(0);
    try {
      const rows = await reviewGame(game, settings.analysisMs, c.signal, (n) =>
        setReviewProgress(n),
      );
      setState((s) => ({
        ...s,
        games: s.games.map((g) =>
          g.id === game.id && g.moves.join() === game.moves.join()
            ? { ...g, review: rows }
            : g,
        ),
      }));
      const first = rows.find((r) => r.loss >= 120);
      setPly(first?.ply || 0);
    } catch (e) {
      if (!c.signal.aborted) toast.error(String(e));
    } finally {
      if (reviewAbort.current === c) setReviewProgress(null);
    }
  }
  function saveCard(r: ReviewMove) {
    const best = r.before.lines[0];
    if (!best) return;
    if (state.cards.some((c) => c.fen === r.before.fen))
      return toast("Already in your practice queue.");
    setState((s) => ({
      ...s,
      cards: [
        ...s.cards,
        {
          id: uid(),
          fen: r.before.fen,
          solution: best.move,
          line: best.pv.slice(0, 8),
          source: game.title,
          themes: themeNames(r.before.fen, best.move),
          due: Date.now(),
          interval: 0,
          lapses: 0,
        },
      ],
    }));
    toast.success("Added to your practice queue.");
  }
  function playHere() {
    const g = newGame({ ...settings, side: selected.turn() }, "stockfish", fen);
    g.title = "Practice from a position";
    setState((s) => ({ ...s, current: g.id, games: [g, ...s.games] }));
    onPage("play");
  }
  function undo() {
    if (branch) {
      setBranch({
        ...branch,
        moves: branch.moves.slice(0, Math.max(0, branch.cursor - 1)),
        cursor: Math.max(0, branch.cursor - 1),
      });
      return;
    }
    abort.current?.abort();
    checkAbort.current?.abort();
    coachingNext.current = null;
    setBusy(false);
    setError("");
    setState((s) => ({
      ...s,
      games: s.games.map((g) =>
        g.id === game.id
          ? {
              ...g,
              moves: g.moves.slice(
                0,
                Math.max(
                  0,
                  g.moves.length -
                    (g.opponent === "local" || board(g).turn() !== g.player
                      ? 1
                      : 2),
                ),
              ),
              result: undefined,
              review: undefined,
            }
          : g,
      ),
    }));
  }
  const moves = live.history();
  const rows = game.review || [];
  const moments = rows.filter(
    (r) => r.loss >= 120 && new Chess(r.before.fen).turn() === game.player,
  );
  const displayGame = branch
    ? {
        ...game,
        initialFen: branch.fen,
        moves: branch.moves.slice(0, branch.cursor),
      }
    : review
      ? { ...game, moves: game.moves.slice(0, ply) }
      : game;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {review
              ? "EVERY GAME HAS SOMETHING TO TEACH"
              : "YOUR PERSONAL CHESS ROOM"}
          </div>
          <h1>
            {review
              ? "Find the moments that matter."
              : "Make your next good move."}
          </h1>
          <p>
            {review
              ? "Slow down. Look again. Take one useful idea into your next game."
              : "A fresh perspective, a little patience, and a board of possibilities."}
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus />
          New game
        </Button>
      </div>
      <div className="workspace">
        <section className="board-column">
          <div className="player-bar">
            <div className="avatar engine">
              <Castle size={23} />
            </div>
            <div>
              <strong>
                {game.opponent === "stockfish"
                  ? "Stockfish"
                  : game.opponent === "local"
                    ? "Analysis board"
                    : game.provider === "claude"
                      ? "Claude"
                      : game.provider}
              </strong>
              <span>
                {game.opponent === "stockfish"
                  ? difficulties[game.difficulty].name
                  : game.opponent === "llm"
                    ? "Independent calculation"
                    : "Move both sides"}
              </span>
            </div>
            <span className="pill">
              {branch ? "Exploring" : review ? "Game review" : "Untimed"}
            </span>
          </div>
          {branch && (
            <div className="branch-banner">
              <span>
                Exploring a variation · {branch.cursor}/{branch.moves.length}
              </span>
              <IconButton
                label="Close variation"
                onClick={() => setBranch(null)}
              >
                <X size={16} />
              </IconButton>
            </div>
          )}
          <div className="board-wrap">
            {settings.showEval &&
              analysis?.fen === fen &&
              !activeLLM &&
              analysis.lines[0] && (
                <div className="eval-rail">
                  <div
                    style={{
                      height: `${50 + 48 * Math.tanh(analysis.lines[0].cp / 600)}%`,
                    }}
                  />
                  <span>{evalText(analysis.lines[0])}</span>
                </div>
              )}
            <Board
              fen={fen}
              orientation={
                flipped ? (game.player === "w" ? "b" : "w") : game.player
              }
              onMove={(m) => void userMove(m)}
              disabled={
                !branch &&
                !review &&
                (busy ||
                  Boolean(game.result) ||
                  (game.opponent !== "local" && live.turn() !== game.player))
              }
              lastMove={
                branch
                  ? branch.moves[branch.cursor - 1]
                  : review
                    ? game.moves[ply - 1]
                    : game.moves.at(-1)
              }
            />
          </div>
          {branch && (
            <div className="variation-controls">
              <IconButton
                label="Previous variation move"
                disabled={!branch.cursor}
                onClick={() =>
                  setBranch({ ...branch, cursor: branch.cursor - 1 })
                }
              >
                <ChevronLeft />
              </IconButton>
              <div>
                {sanLine(branch.fen, branch.moves).map((s, i) => (
                  <button
                    key={i}
                    className={branch.cursor === i + 1 ? "active" : ""}
                    onClick={() => setBranch({ ...branch, cursor: i + 1 })}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <IconButton
                label="Next variation move"
                disabled={branch.cursor === branch.moves.length}
                onClick={() =>
                  setBranch({ ...branch, cursor: branch.cursor + 1 })
                }
              >
                <ChevronRight />
              </IconButton>
            </div>
          )}
          <div className="player-bar you">
            <div className="avatar">
              <UserRound size={22} />
            </div>
            <div>
              <strong>
                You <small>{game.player === "w" ? "White" : "Black"}</small>
              </strong>
              <span>{settings.rating} practice level</span>
            </div>
            <span className="turn">
              {busy ? <Busy>Thinking</Busy> : status(selected)}
            </span>
          </div>
          <div className="board-toolbar">
            <div>
              <IconButton
                label="Flip board"
                onClick={() => setFlipped(!flipped)}
              >
                <RotateCw />
              </IconButton>
              <IconButton
                label="Take back"
                disabled={
                  (review && !branch) || (!game.moves.length && !branch)
                }
                onClick={undo}
              >
                <RotateCcw />
              </IconButton>
              <IconButton
                label="Export PGN"
                onClick={() => download("greenroom-game.pgn", exportPgn(game))}
              >
                <Download />
              </IconButton>
              {!review && (
                <IconButton
                  label="Resign game"
                  disabled={Boolean(game.result) || !game.moves.length}
                  onClick={() => setResign(true)}
                >
                  <Flag />
                </IconButton>
              )}
            </div>
            <span>
              {review
                ? `Position ${ply} / ${game.moves.length}`
                : "Saved on this device"}
            </span>
            {review ? (
              <div>
                <IconButton
                  label="First position"
                  onClick={() => {
                    setBranch(null);
                    setPly(0);
                  }}
                >
                  <ChevronsLeft />
                </IconButton>
                <IconButton
                  label="Previous move"
                  disabled={!ply}
                  onClick={() => {
                    setBranch(null);
                    setPly(ply - 1);
                  }}
                >
                  <ChevronLeft />
                </IconButton>
                <IconButton
                  label="Next move"
                  disabled={ply === game.moves.length}
                  onClick={() => {
                    setBranch(null);
                    setPly(ply + 1);
                  }}
                >
                  <ChevronRight />
                </IconButton>
                <IconButton
                  label="Last position"
                  onClick={() => {
                    setBranch(null);
                    setPly(game.moves.length);
                  }}
                >
                  <ChevronsRight />
                </IconButton>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={activeLLM}
                onClick={() => onPage("review")}
              >
                Review
                <ChevronRight />
              </Button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry turn
              </Button>
            </div>
          )}
          {game.result && !branch && (
            <div className="result-banner">
              <Leaf />
              <div>
                <strong>
                  {game.result === "1/2-1/2"
                    ? "A drawn game."
                    : game.result === (game.player === "w" ? "1-0" : "0-1")
                      ? "Well played. You won."
                      : "A game to learn from."}
                </strong>
                <p>Let’s take a look at the useful moments.</p>
              </div>
              <Button variant="secondary" onClick={() => onPage("review")}>
                Review game
              </Button>
            </div>
          )}
          {!activeLLM && (
            <div className="board-actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={analysing || busy}
                onClick={() => void analyse()}
              >
                {analysing ? (
                  <Busy>Analysing</Busy>
                ) : (
                  <>
                    <ScanSearch />
                    Analyse position
                  </>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={playHere}>
                <Play />
                Play from here
              </Button>
            </div>
          )}
          {analysis?.fen === fen && !activeLLM && (
            <div className="engine-lines">
              <div className="eyebrow">
                STOCKFISH · {analysis.lines[0]?.depth || 0} PLY SEARCH
              </div>
              {analysis.lines.map((l, i) => (
                <button
                  key={i}
                  onClick={() =>
                    setBranch({ fen, moves: l.pv.slice(0, 10), cursor: 0 })
                  }
                >
                  <b>{evalText(l)}</b>
                  <span>{sanLine(fen, l.pv.slice(0, 8)).join("  ")}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="side-panel">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="coach">
                <Lightbulb />
                Coach
              </TabsTrigger>
              <TabsTrigger value="moves">
                Moves{" "}
                <span className="count">{Math.ceil(moves.length / 2)}</span>
              </TabsTrigger>
              {review && <TabsTrigger value="review">Review</TabsTrigger>}
            </TabsList>
            <TabsContent value="coach">
              <Chat
                key={game.id}
                game={displayGame}
                fen={fen}
                settings={settings}
                config={config}
                messages={state.chats[game.id] || []}
                onMessages={(messages) =>
                  setState((s) => ({
                    ...s,
                    chats: { ...s.chats, [game.id]: messages },
                  }))
                }
                onDetail={(detail) =>
                  setState((s) => ({
                    ...s,
                    settings: { ...s.settings, detail },
                  }))
                }
                onShowLine={(fen, moves) =>
                  setBranch({ fen, moves, cursor: 0 })
                }
                onConnect={() => onPage("settings")}
                onCall={onCall}
                onUsage={onUsage}
                evidence={supplied}
                prompt={prompt}
              />
            </TabsContent>
            <TabsContent value="moves">
              <div className="panel-heading">
                <h3>The story so far</h3>
                <p>{game.title}</p>
              </div>
              {moves.length ? (
                <div className="move-table">
                  {Array.from(
                    { length: Math.ceil(moves.length / 2) },
                    (_, i) => (
                      <div key={i}>
                        <span>{i + 1}.</span>
                        {[i * 2, i * 2 + 1].map((p) => (
                          <button
                            disabled={!moves[p] || activeLLM}
                            className={review && ply === p + 1 ? "active" : ""}
                            key={p}
                            onClick={() => {
                              onPage("review");
                              setPly(p + 1);
                              setBranch(null);
                            }}
                          >
                            {moves[p] || "—"}
                            {rows[p] && <i className={rows[p].category} />}
                          </button>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <Empty title="Your game starts here" icon={<BookOpen />}>
                  Make your first move. Your move history will appear here.
                </Empty>
              )}
            </TabsContent>
            {review && (
              <TabsContent value="review">
                <div className="panel-heading">
                  <h3>A few moments worth keeping.</h3>
                  <p>
                    Stockfish finds turning points. Your coach helps you
                    understand them.
                  </p>
                </div>
                <div className="review-content">
                  {reviewProgress !== null ? (
                    <>
                      <Busy>
                        Reviewing {reviewProgress} of {game.moves.length} moves
                      </Busy>
                      <progress
                        value={reviewProgress}
                        max={game.moves.length}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          reviewAbort.current?.abort();
                          setReviewProgress(null);
                        }}
                      >
                        Stop review
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="wide"
                      disabled={!game.moves.length}
                      onClick={() => void runReview()}
                    >
                      <ScanSearch />
                      {rows.length ? "Analyse again" : "Review this game"}
                    </Button>
                  )}
                  {rows.length > 0 && (
                    <>
                      <div className="review-stats">
                        <div>
                          <b>{rows.filter((r) => r.loss < 60).length}</b>
                          <span>Solid moves</span>
                        </div>
                        <div>
                          <b>{moments.length}</b>
                          <span>Your learning moments</span>
                        </div>
                      </div>
                      <Button
                        className="wide"
                        variant="secondary"
                        onClick={() => {
                          if (
                            !config.unlocked ||
                            !config.models.some(
                              (m) => m.id === settings.provider && m.ready,
                            )
                          ) {
                            toast(
                              "Connect AI for a conversational game summary.",
                            );
                            onPage("settings");
                            return;
                          }
                          const top = [...rows]
                            .filter(
                              (r) =>
                                new Chess(r.before.fen).turn() === game.player,
                            )
                            .sort((a, b) => b.loss - a.loss)
                            .slice(0, 3);
                          setEvidence(top.flatMap((r) => [r.before, r.after]));
                          setPly(game.moves.length);
                          setBranch(null);
                          setState((s) => ({
                            ...s,
                            settings: { ...s.settings, detail: 5 },
                          }));
                          setTab("coach");
                          setPrompt({
                            id: uid(),
                            text:
                              "Review this game and give me three useful lessons. Focus on these analysed moments: " +
                              top
                                .map(
                                  (r) =>
                                    `${Math.floor(r.ply / 2) + 1}. ${r.san} at ${r.before.fen}`,
                                )
                                .join("; "),
                          });
                        }}
                      >
                        <BookOpen />
                        My three lessons
                      </Button>
                      <p className="small muted">
                        Move labels are approximate evaluation loss, not a
                        rating.
                      </p>
                      {(moments.length
                        ? moments
                        : rows.filter((r) => r.loss >= 60)
                      )
                        .slice(0, 14)
                        .map((r) => (
                          <div className="moment" key={r.ply}>
                            <button
                              className="moment-main"
                              onClick={() => {
                                setPly(r.ply);
                                setBranch(null);
                              }}
                            >
                              <span className={"category " + r.category}>
                                {r.category}
                              </span>
                              <strong>
                                {Math.floor(r.ply / 2) + 1}
                                {r.ply % 2 ? "…" : "."} {r.san}
                              </strong>
                              <span>
                                {Math.min(r.loss / 100, 99).toFixed(1)} eval
                                lost
                              </span>
                            </button>
                            <div className="row">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setPly(r.ply);
                                  setBranch(null);
                                  setState((s) => ({
                                    ...s,
                                    settings: { ...s.settings, detail: 5 },
                                  }));
                                  setTab("coach");
                                  setPrompt({
                                    id: uid(),
                                    text: `Why was ${r.san} weaker than ${sanLine(r.before.fen, [r.before.lines[0].move])[0]}? Compare the supplied analyses and show one useful continuation.`,
                                  });
                                }}
                              >
                                <Lightbulb />
                                Why?
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => saveCard(r)}
                              >
                                <Bookmark />
                                Practise
                              </Button>
                            </div>
                          </div>
                        ))}
                      {!moments.length && (
                        <p className="positive">
                          No large mistakes found for your side in this search.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
          <div className="panel-footer">
            <span />
            {activeLLM
              ? "Your opponent plays independently"
              : "A little better, one move at a time."}
          </div>
        </aside>
      </div>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(v) => {
          if (!v) setPending(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {pending && pending.loss >= 120
              ? "Take one more look?"
              : "A moment before you move."}
          </DialogTitle>
          <DialogDescription>
            {pending && pending.loss >= 120
              ? "There may be a stronger choice. Check your opponent’s forcing replies."
              : "Have you checked your opponent’s checks, captures, and threats?"}
          </DialogDescription>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Let me reconsider
            </Button>
            <Button
              onClick={() => {
                if (pending) apply(pending.move, pending.fen, pending.ply);
                setPending(null);
              }}
            >
              Play my move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resign} onOpenChange={setResign}>
        <DialogContent>
          <DialogTitle>Finish this game?</DialogTitle>
          <DialogDescription>You can review it afterwards.</DialogDescription>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setResign(false)}>
              Keep playing
            </Button>
            <Button
              onClick={() => {
                abort.current?.abort();
                setState((s) => ({
                  ...s,
                  games: s.games.map((g) =>
                    g.id === game.id
                      ? { ...g, result: g.player === "w" ? "0-1" : "1-0" }
                      : g,
                  ),
                }));
                setResign(false);
              }}
            >
              Resign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
