import { useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp, Lightbulb, Leaf, Square, LockKeyhole } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Busy } from "./common";
import { engine } from "@/lib/engine";
import { localHint } from "@/lib/review";
import { streamCoach } from "@/lib/api";
import { uid, sanLine } from "@/lib/chess";
import type { Analysis, Config, Game, Message, Settings } from "@/lib/types";
function Text() {
  return <MarkdownTextPrimitive className="markdown" />;
}
function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-message user">
      <MessagePrimitive.Parts components={{ Text }} />
    </MessagePrimitive.Root>
  );
}
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-message assistant">
      <div className="message-label">
        <Leaf size={13} />
        GREENROOM COACH
      </div>
      <MessagePrimitive.Parts components={{ Text }} />
    </MessagePrimitive.Root>
  );
}
const details = [
  "A gentle question",
  "Point me toward an idea",
  "Name the piece",
  "Suggest a move",
  "Show and explain",
];
export function Chat({
  game,
  fen,
  settings,
  config,
  messages,
  onMessages,
  onDetail,
  onShowLine,
  onConnect,
  onCall,
  onUsage,
  evidence = [],
  prompt,
}: {
  game: Game;
  fen: string;
  settings: Settings;
  config: Config;
  messages: Message[];
  onMessages: (m: Message[]) => void;
  onDetail: (n: number) => void;
  onShowLine: (fen: string, line: string[]) => void;
  onConnect: () => void;
  onCall: () => boolean;
  onUsage: (v: { inputTokens?: number; outputTokens?: number }) => void;
  evidence?: Analysis[];
  prompt?: { id: string; text: string };
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const history = useRef(messages);
  history.current = messages;
  const lastPrompt = useRef("");
  const locked = game.opponent === "llm" && !game.result;
  const available =
    config.unlocked &&
    config.models.some((m) => m.id === settings.provider && m.ready);
  useEffect(() => {
    abort.current?.abort();
    setRunning(false);
    setError("");
    return () => abort.current?.abort();
  }, [fen, game.id]);
  async function send(text: string, detail = settings.detail) {
    if (running || locked) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    const id = uid();
    const base = [
      ...history.current,
      { id: uid(), role: "user" as const, text, fen },
    ];
    let answer = "";
    let shown: string[] | undefined;
    const update = () => {
      if (!controller.signal.aborted)
        onMessages([
          ...base,
          { id, role: "assistant", text: answer, fen, line: shown },
        ]);
    };
    onMessages(base);
    try {
      const analysis = await engine.analyze(
        fen,
        settings.analysisMs,
        3,
        controller.signal,
      );
      if (!available) {
        answer = localHint(analysis, detail);
        shown = detail === 5 ? analysis.lines[0]?.pv.slice(0, 8) : undefined;
        update();
        return;
      }
      if (!onCall())
        throw Error(
          "Your daily AI call limit is reached. Increase it in Settings if needed.",
        );
      await streamCoach(
        {
          game,
          fen,
          provider: settings.provider,
          rating: settings.rating,
          detail,
          level: settings.level,
          messages: base
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.text })),
          evidence: [analysis, ...evidence.filter((a) => a.fen !== fen)].slice(
            0,
            8,
          ),
        },
        controller.signal,
        (e) => {
          if (e.type === "text") {
            answer += e.text || "";
            update();
          }
          if (e.type === "line") {
            shown = e.line;
            update();
          }
          if (e.type === "usage" && e.usage) onUsage(e.usage);
        },
      );
      if (!answer) {
        answer = "Try asking about one move or one idea in this position.";
        update();
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Coach unavailable");
    } finally {
      if (abort.current === controller) setRunning(false);
    }
  }
  useEffect(() => {
    if (prompt && lastPrompt.current !== prompt.id && !running && !locked) {
      lastPrompt.current = prompt.id;
      void send(prompt.text);
    }
  }, [prompt?.id, running, locked]);
  const runtime = useExternalStoreRuntime<Message>({
    messages,
    isRunning: running,
    convertMessage: (m) => ({
      id: m.id,
      role: m.role,
      content: [{ type: "text", text: m.text }],
    }),
    onNew: async (m) => {
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      await send(text);
    },
    onCancel: async () => {
      abort.current?.abort();
      setRunning(false);
    },
  });
  if (locked)
    return (
      <div className="locked-coach">
        <LockKeyhole size={28} />
        <h3>A fair game.</h3>
        <p>
          Your opponent plays with its own calculation. Coaching and Stockfish
          analysis unlock when this game ends.
        </p>
        <span className="pill">Engine access blocked</span>
      </div>
    );
  return (
    <div className="chat">
      <div className="hint-control">
        <div>
          <span>Hint detail</span>
          <strong>{details[settings.detail - 1]}</strong>
        </div>
        <Slider
          aria-label="Hint detail"
          value={[settings.detail]}
          min={1}
          max={5}
          step={1}
          onValueChange={(v) => onDetail(v[0])}
        />
        <div className="hint-scale">
          <span>Gentle</span>
          <span>Explicit</span>
        </div>
      </div>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="messages">
            {!messages.length && (
              <div className="coach-welcome">
                <div className="coach-emblem">
                  <Leaf size={27} />
                </div>
                <h2>
                  A little guidance.
                  <br />A better next move.
                </h2>
                <p>
                  Ask about the position, explore an idea, or take a gentle
                  hint. We’ll go at your pace.
                </p>
                <div className="suggestions">
                  <Button
                    variant="outline"
                    onClick={() => void send("What should I pay attention to?")}
                  >
                    What should I look for?
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void send("Help me make a plan for this position.")
                    }
                  >
                    Help me find a plan
                  </Button>
                </div>
              </div>
            )}
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
            {running && <Busy>Thinking through the position</Busy>}
            {messages
              .filter((m) => m.line?.length && m.fen)
              .slice(-2)
              .map((m) => (
                <button
                  key={m.id}
                  className="line-card"
                  onClick={() => onShowLine(m.fen!, m.line!)}
                >
                  <span>EXPLORE THIS LINE ↗</span>
                  {sanLine(m.fen!, m.line!).join(" · ")}
                </button>
              ))}
          </ThreadPrimitive.Viewport>
          <div className="chat-bottom">
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="row">
              <Button
                variant="secondary"
                size="sm"
                disabled={running}
                onClick={() => void send("Give me a hint.")}
              >
                <Lightbulb />
                Hint
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={running || settings.detail === 5}
                onClick={() => {
                  const n = Math.min(5, settings.detail + 1);
                  onDetail(n);
                  void send("A little more help, please.", n);
                }}
              >
                A little more help
              </Button>
              {running && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    abort.current?.abort();
                    setRunning(false);
                  }}
                  aria-label="Stop response"
                >
                  <Square size={14} />
                </Button>
              )}
            </div>
            {!available && (
              <button className="connect-note" onClick={onConnect}>
                Engine hints are ready. Connect AI for conversation. ↗
              </button>
            )}
            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input
                placeholder="Ask about this position…"
                aria-label="Message your coach"
              />
              <ComposerPrimitive.Send asChild>
                <Button size="icon" aria-label="Send message">
                  <ArrowUp size={17} />
                </Button>
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
            <span className="composer-note">
              Your coach can be wrong. Explore the board together.
            </span>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}
