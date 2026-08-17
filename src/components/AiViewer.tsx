import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Send, Sparkles, Square } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "./ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./ai-elements/reasoning";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  describeInferenceError,
  getInference,
  getInferenceFeatures,
  isInferenceAvailable,
} from "@/services/inference";
import type { InferenceMessage, Usage } from "@/types/inference";
import { useLocale } from "@/hooks/useLocale";
import { ProviderLogo, providerFromModel } from "./ai/ProviderLogo";
import { useAddWindow } from "@/core/state";
import { splitNostrRefs, type NostrRefTarget } from "@/lib/open-nostr-ref";

interface AiViewerProps {
  /** Prompt from the command line. Prefilled, not sent. */
  prompt?: string;
  system?: string;
}

/**
 * Render markdown text, turning any bech32 nostr entity into a button that
 * opens the window for it. A model that names an npub or nevent should be as
 * clickable as a note that does.
 */
function LinkedText({
  children,
  onOpen,
}: {
  children?: ReactNode;
  onOpen: (target: NostrRefTarget, label: string) => void;
}) {
  if (typeof children !== "string") return <>{children}</>;

  const segments = splitNostrRefs(children);
  if (segments.length === 1 && !segments[0].target) return <>{children}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.target ? (
          <button
            className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
            key={`${index}-${segment.text}`}
            onClick={() => onOpen(segment.target!, segment.text)}
            title={segment.text}
            type="button"
          >
            {segment.text.slice(0, 12)}…
          </button>
        ) : (
          <span key={`${index}-plain`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** A turn as rendered. `pending` marks the assistant turn currently streaming. */
interface Turn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  pending?: boolean;
  /** From the `done` chunk. The model is the extension's choice, not ours. */
  model?: string;
  usage?: Usage;
}

/** Apply LinkedText to the string leaves of a markdown element's children. */
function withLinks(
  children: ReactNode,
  onOpen: (target: NostrRefTarget, label: string) => void,
): ReactNode {
  if (typeof children === "string") {
    return <LinkedText onOpen={onOpen}>{children}</LinkedText>;
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{withLinks(child, onOpen)}</Fragment>
    ));
  }
  return children;
}

/**
 * Model and token counts from the `done` chunk. No cost: the spec leaves
 * pricing metadata undefined, so any figure here would be invented.
 */
function TurnUsage({
  locale,
  model,
  usage,
}: {
  locale: string;
  model?: string;
  usage?: Usage;
}) {
  if (!model && !usage) return null;
  // Compact so a long model id and both counts fit one line in a narrow window.
  const format = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format;

  // `anthropic/claude-haiku-4.5` → provider mark plus `claude-haiku-4.5`.
  const provider = providerFromModel(model);
  const modelName = provider ? model!.slice(provider.length + 1) : model;

  return (
    <div className="flex flex-wrap items-center gap-x-2 pt-1 text-xs text-muted-foreground">
      {model && (
        <span className="flex items-center gap-1" title={model}>
          <ProviderLogo provider={provider} />
          <span className="font-mono">{modelName}</span>
        </span>
      )}
      {usage?.inputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Input tokens">
          <ArrowUp className="size-3" />
          {format(usage.inputTokens)}
        </span>
      )}
      {usage?.outputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Output tokens">
          <ArrowDown className="size-3" />
          {format(usage.outputTokens)}
        </span>
      )}
    </div>
  );
}

export default function AiViewer({ prompt, system }: AiViewerProps) {
  const { locale } = useLocale();
  const addWindow = useAddWindow();
  const [turns, setTurns] = useState<Turn[]>([]);
  // The command-line prompt is prefilled, not sent. Windows are restored from
  // localStorage on load, and auto-sending would re-spend on every reload.
  const [input, setInput] = useState(prompt ?? "");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Availability is read once: an injector that appears later is picked up on
  // the next send, which throws `unavailable` with the same message.
  const available = isInferenceAvailable();
  const features = available ? getInferenceFeatures() : {};

  // Markdown element overrides for MessageResponse. Memoized because a new
  // object each render would defeat its memo and re-parse the whole reply.
  const markdownComponents = useMemo(() => {
    const onOpen = (target: NostrRefTarget, label: string) =>
      addWindow(target.appId, target.props, `open ${label}`);
    return {
      p: ({ children }: { children?: ReactNode }) => (
        <p>{withLinks(children, onOpen)}</p>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li>{withLinks(children, onOpen)}</li>
      ),
    };
  }, [addWindow]);

  const send = useCallback(
    async (text: string) => {
      const history: InferenceMessage[] = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...turns
          .filter((turn) => !turn.pending)
          .map((turn) =>
            turn.role === "user"
              ? { role: "user" as const, content: turn.content }
              : {
                  role: "assistant" as const,
                  content: turn.content,
                  ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
                },
          ),
        { role: "user", content: text },
      ];

      setError(null);
      setTurns((previous) => [
        ...previous,
        { role: "user", content: text },
        { role: "assistant", content: "", pending: true },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      // Accumulate off-state and flush on a frame so a token-per-render
      // stream does not thrash the tree.
      let content = "";
      let reasoning = "";
      let model: string | undefined;
      let usage: Usage | undefined;
      let queued = false;
      const flush = () => {
        queued = false;
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 && turn.pending
              ? {
                  ...turn,
                  content,
                  ...(reasoning ? { reasoning } : {}),
                }
              : turn,
          ),
        );
      };
      const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(flush);
      };

      try {
        for await (const chunk of getInference().request({
          method: "chat",
          messages: history,
          signal: controller.signal,
          // Unadvertised option keys must be ignored, not rejected, so this is
          // safe to send unconditionally.
          options: { reasoningEffort: "auto" },
        })) {
          switch (chunk.type) {
            case "delta":
              content += chunk.content;
              schedule();
              break;
            case "reasoning_delta":
              reasoning += chunk.content;
              schedule();
              break;
            case "done":
              model = chunk.model;
              usage = chunk.usage;
              content =
                chunk.message.role === "assistant"
                  ? (chunk.message.content ?? content)
                  : content;
              if (
                chunk.message.role === "assistant" &&
                chunk.message.reasoning
              ) {
                reasoning = chunk.message.reasoning;
              }
              break;
            default:
              break;
          }
        }
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 && turn.pending
              ? {
                  role: "assistant",
                  content,
                  ...(reasoning ? { reasoning } : {}),
                  ...(model ? { model } : {}),
                  ...(usage ? { usage } : {}),
                }
              : turn,
          ),
        );
      } catch (caught) {
        setError(describeInferenceError(caught));
        // Drop the empty pending turn; the error is shown instead.
        setTurns((previous) =>
          previous.filter(
            (turn, index) =>
              !(index === previous.length - 1 && turn.pending && !turn.content),
          ),
        );
      } finally {
        controllerRef.current = null;
        setStreaming(false);
      }
    },
    [system, turns],
  );

  // Closing the window must cancel in-flight provider work.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    void send(text);
  };

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Sparkles className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">No inference provider</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Install an extension that injects{" "}
            <code className="text-xs">window.inference</code> — grimoire never
            sees your API keys. Reopen this window once it is installed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/*
        `min-h-0` is load-bearing: a flex item defaults to min-height:auto, so
        Conversation would grow past the pane and the window's own overflow-auto
        would scroll instead. StickToBottom's scroller is height:100% of this
        element, so an unbounded height means it never scrolls — and never
        follows the stream.
      */}
      <Conversation className="min-h-0">
        <ConversationContent>
          {turns.length === 0 ? (
            <ConversationEmptyState
              icon={<Sparkles className="size-8" />}
              title="Ask anything"
              description="Your extension picks the provider and model."
            />
          ) : (
            turns.map((turn, index) => (
              <Message from={turn.role} key={index}>
                <MessageContent>
                  {turn.reasoning && (
                    <Reasoning isStreaming={Boolean(turn.pending)}>
                      <ReasoningTrigger />
                      <ReasoningContent>{turn.reasoning}</ReasoningContent>
                    </Reasoning>
                  )}
                  <MessageResponse components={markdownComponents}>
                    {turn.content}
                  </MessageResponse>
                  {turn.role === "assistant" && !turn.pending && (
                    <TurnUsage
                      locale={locale}
                      model={turn.model}
                      usage={turn.usage}
                    />
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div className="mx-4 mb-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Matches the chat composer: border-t, tight padding, flex-1 input. */}
      <div className="border-t px-2 py-1">
        <div className="flex items-end gap-1.5">
          <Textarea
            className="min-h-7 max-h-40 flex-1 min-w-0 resize-none py-1 text-sm"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything..."
            rows={1}
            value={input}
          />
          {streaming ? (
            <Button
              className="h-7 flex-shrink-0 px-2 text-xs"
              onClick={() => controllerRef.current?.abort()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Square className="size-3" />
              Stop
            </Button>
          ) : (
            <Button
              className="h-7 flex-shrink-0 px-2 text-xs"
              disabled={!input.trim()}
              onClick={submit}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Send className="size-3" />
              Send
            </Button>
          )}
        </div>
      </div>

      {features.toolCalling && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          Provider advertises tool calling.
        </div>
      )}
    </div>
  );
}
