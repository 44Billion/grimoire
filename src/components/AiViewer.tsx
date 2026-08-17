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
import { useLiveQuery } from "dexie-react-hooks";
import {
  loadConversation,
  saveConversation,
} from "@/services/ai-conversations";
import { buildAiContext, type AiTarget } from "@/lib/ai-context";
import { ProviderLogo, providerFromModel } from "./ai/ProviderLogo";
import { useAddWindow } from "@/core/state";
import {
  hasEventEmbed,
  splitNostrRefs,
  type NostrRefTarget,
} from "@/lib/open-nostr-ref";
import { UserName } from "./nostr/UserName";
import { EmbeddedEvent } from "./nostr/EmbeddedEvent";

interface AiViewerProps {
  /** Prompt from the command line. Prefilled, not sent. */
  prompt?: string;
  system?: string;
  /** Key for persisted turns. Without it the conversation is ephemeral. */
  windowId?: string;
  /** Object the question is about. Its own data becomes the system prompt. */
  target?: AiTarget;
}

/**
 * Render markdown text, showing every bech32 entity as the thing it names: a
 * person as `UserName`, an event through the feed renderer, anything else as a
 * link. A model that mentions an npub should read like a note that does.
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
      {segments.map((segment, index) => {
        const key = `${index}-${segment.text}`;
        const target = segment.target;

        if (!target) return <span key={`${index}-plain`}>{segment.text}</span>;

        // A person renders as a person: display name, member badge, flame.
        // UserName opens the profile itself.
        if (target.pubkey) {
          return (
            <UserName
              isMention
              key={key}
              pubkey={target.pubkey}
              relayHints={target.relays}
            />
          );
        }

        // An event renders through the same registry the feed uses, so a
        // mentioned note looks like a note and a mentioned NIP like a NIP.
        if (target.eventPointer || target.addressPointer) {
          return (
            <EmbeddedEvent
              addressPointer={target.addressPointer}
              eventPointer={target.eventPointer}
              key={key}
              onOpen={() => onOpen(target, segment.text)}
            />
          );
        }

        return (
          <button
            className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
            key={key}
            onClick={() => onOpen(target, segment.text)}
            title={segment.text}
            type="button"
          >
            {segment.text.slice(0, 12)}…
          </button>
        );
      })}
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

/** True when any string leaf holds a reference that renders as a block embed. */
function containsEventEmbed(children: ReactNode): boolean {
  if (typeof children === "string") return hasEventEmbed(children);
  if (Array.isArray(children)) return children.some(containsEventEmbed);
  return false;
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

export default function AiViewer({
  prompt,
  system,
  target,
  windowId,
}: AiViewerProps) {
  const { locale } = useLocale();
  const addWindow = useAddWindow();

  // The target's own data — event JSON, kind registry entry, cached NIP text —
  // becomes the system prompt. Resolved through a live query so it picks up an
  // event or NIP that arrives after the window opens.
  const context = useLiveQuery(
    () => (target ? buildAiContext(target) : Promise.resolve(undefined)),
    [target?.type, target?.value],
  );

  // Turns live in Dexie so a reload restores them with the window. `stored`
  // seeds the first render; after that local state owns them, so a streaming
  // reply is never fighting a query result.
  const stored = useLiveQuery(
    () => (windowId ? loadConversation(windowId) : Promise.resolve([])),
    [windowId],
  );
  const [local, setLocal] = useState<Turn[] | null>(null);
  const turns: Turn[] = local ?? stored ?? [];
  const setTurns = useCallback(
    (update: (previous: Turn[]) => Turn[]) => {
      setLocal((previous) => update(previous ?? stored ?? []));
    },
    [stored],
  );
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
      // An event embed is a block, and a <div> inside a <p> is invalid HTML
      // that browsers repair by splitting the paragraph. Swap the tag instead.
      p: ({ children }: { children?: ReactNode }) =>
        containsEventEmbed(children) ? (
          <div className="mb-4">{withLinks(children, onOpen)}</div>
        ) : (
          <p>{withLinks(children, onOpen)}</p>
        ),
      li: ({ children }: { children?: ReactNode }) => (
        <li>{withLinks(children, onOpen)}</li>
      ),
    };
  }, [addWindow]);

  const send = useCallback(
    async (text: string) => {
      // An explicit --system wins over the target's context; otherwise the
      // target grounds the conversation.
      const systemPrompt = system ?? context?.system;
      const history: InferenceMessage[] = [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
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
        // Rebuild from the turns we started with so earlier model and usage
        // survive; the placeholder is replaced, not patched.
        const settled: Turn[] = [
          ...turns.filter((turn) => !turn.pending),
          { role: "user", content: text },
          {
            role: "assistant",
            content,
            ...(reasoning ? { reasoning } : {}),
            ...(model ? { model } : {}),
            ...(usage ? { usage } : {}),
          },
        ];
        setLocal(settled);
        // Save once the turn is settled, never mid-stream — a partial reply is
        // not worth a write per frame.
        if (windowId) void saveConversation(windowId, settled);
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
    [context?.system, system, turns, setTurns, windowId],
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
              title={context ? `Ask about ${context.label}` : "Ask anything"}
              description={
                context
                  ? "Grounded in the local copy — no data leaves except the prompt."
                  : "Your extension picks the provider and model."
              }
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
