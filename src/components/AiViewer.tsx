import {
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ExternalLink, Send, Square } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { MessageResponse } from "./ai-elements/message";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  describeInferenceError,
  isAnyInferenceReachable,
  isInferenceAvailable,
  onModelDownloadProgress,
  resolveRequest,
  type ToolSupport,
} from "@/services/inference";
import { PROMPT_API_MODEL } from "@/services/prompt-api";
import { runToolLoop } from "@/services/tool-loop";
import type { InferenceMessage, Usage } from "@/types/inference";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import { useLiveQuery } from "dexie-react-hooks";
import {
  loadConversation,
  saveConversation,
} from "@/services/ai-conversations";
import {
  buildAiContext,
  buildMentionContext,
  GENERAL_SUGGESTIONS,
  toolsSystem,
  type AiTarget,
} from "@/lib/ai-context";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { AgentPanel } from "./ai/AgentPanel";
import { HEX_NAME, HexAvatar } from "./ai/Hex";
import { Shimmer } from "./ai-elements/shimmer";
import { CommandChips } from "./ai/CommandChips";
import { ConversationIndex } from "./ai/ConversationIndex";
import { ReplyCodeBlock } from "./ai/ReplyCodeBlock";
import { COMMAND_FENCE, resolveCommand } from "@/lib/ai-commands";
import { AI_TOOLS, createToolExecutors, refuseIfNeeded } from "@/lib/ai-tools";
import { TurnSteps } from "./ai/TurnSteps";
import type { ToolRun } from "@/types/tool-part";
import { useAccount } from "@/hooks/useAccount";
import { ProviderLogo, providerFromModel } from "./ai/ProviderLogo";
import { useAddWindow } from "@/core/state";
import {
  hasEventEmbed,
  nostrRefTarget,
  splitNostrRefs,
  type NostrRefTarget,
} from "@/lib/open-nostr-ref";
import { UserName } from "./nostr/UserName";
import { cn } from "@/lib/utils";
import { EmbeddedEvent } from "./nostr/EmbeddedEvent";

interface AiViewerProps {
  /** Prompt from the command line. Sent once, when nothing is stored yet. */
  prompt?: string;
  system?: string;
  /** Key for persisted turns. Without it the conversation is ephemeral. */
  windowId?: string;
  /** Adopt an existing stored conversation instead of starting a new one. */
  conversation?: string;
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

/**
 * Download progress as Chrome reports it — a 0..1 fraction in current builds,
 * bytes in older ones, and there is no header saying which.
 */
function formatDownload(loaded: number): string {
  if (loaded <= 1) return `${Math.round(loaded * 100)}%`;
  return `${Math.round(loaded / 1_000_000)} MB`;
}

/** A turn as rendered. `pending` marks the assistant turn currently streaming. */
interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Unix seconds, for the row's relative time. */
  at?: number;
  /** Kept for turns stored before reasoning was split per round. */
  reasoning?: string;
  /** Each round's reasoning, so it renders around the calls it explains. */
  reasoningRounds?: string[];
  pending?: boolean;
  /** From the `done` chunk. The model is the extension's choice, not ours. */
  model?: string;
  usage?: Usage;
  toolRuns?: ToolRun[];
}

/**
 * Source of a ```grimoire fence, or null for any other code block. Markdown
 * renders a fence as `<pre><code class="language-grimoire">…`, so the language
 * lives on the child.
 */
function fencedBlock(
  children: ReactNode,
): { language?: string; code: string } | null {
  if (!isValidElement(children)) return null;
  const props = children.props as {
    className?: unknown;
    children?: unknown;
  };
  if (typeof props.children !== "string") return null;
  const className =
    typeof props.className === "string" ? props.className : undefined;
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
  return { code: props.children, ...(language ? { language } : {}) };
}

/** True when any string leaf holds a reference that renders as a block embed. */
function containsEventEmbed(children: ReactNode): boolean {
  if (typeof children === "string") return hasEventEmbed(children);
  if (Array.isArray(children)) return children.some(containsEventEmbed);
  if (isValidElement(children)) {
    return containsEventEmbed(
      (children.props as { children?: ReactNode }).children,
    );
  }
  return false;
}

/** A reference inside these is text on purpose, so it stays text. */
const LITERAL_TAGS = new Set(["code", "pre"]);

/** True when a string leaf holds any reference grimoire can resolve. */
function containsNostrRef(children: ReactNode): boolean {
  if (typeof children === "string") {
    return splitNostrRefs(children).some((segment) => segment.target);
  }
  if (Array.isArray(children)) return children.some(containsNostrRef);
  if (isValidElement(children)) {
    return containsNostrRef(
      (children.props as { children?: ReactNode }).children,
    );
  }
  return false;
}

/**
 * Apply LinkedText to the string leaves of a markdown element's children.
 *
 * It walks into elements, not just arrays: a `nostr:` reference lands inside
 * whatever markdown wrapped it — bold, a link, a heading — and stopping at the
 * first element left those rendering as raw bech32.
 */
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
  if (isValidElement(children)) {
    if (typeof children.type === "string" && LITERAL_TAGS.has(children.type)) {
      return children;
    }
    const inner = (children.props as { children?: ReactNode }).children;
    if (inner === undefined) return children;
    // An autolinked reference loses its anchor: what replaces it is a button or
    // an embed, and neither is valid inside an <a>.
    if (children.type === "a" && containsNostrRef(inner)) {
      return withLinks(inner, onOpen);
    }
    return cloneElement(
      children as ReactElement<{ children?: ReactNode }>,
      undefined,
      withLinks(inner, onOpen),
    );
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
      {model && (
        <span className="flex items-center gap-1" title={model}>
          <ProviderLogo className="size-2.5" provider={provider} />
          <span className="font-mono">{modelName}</span>
        </span>
      )}
      {usage?.inputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Input tokens">
          <ArrowUp className="size-2.5" />
          {format(usage.inputTokens)}
        </span>
      )}
      {usage?.outputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Output tokens">
          <ArrowDown className="size-2.5" />
          {format(usage.outputTokens)}
        </span>
      )}
    </div>
  );
}

export default function AiViewer({
  conversation,
  prompt,
  system,
  target,
  windowId,
}: AiViewerProps) {
  // An adopted conversation keeps its original key, so reopening it from the
  // index reads and writes the same row.
  const storageId = conversation ?? windowId;
  // Nothing to ground on and nothing asked: this window is the index.
  const isBare = !target && !prompt && !conversation && !system;
  const { locale } = useLocale();
  const addWindow = useAddWindow();
  const { pubkey } = useAccount();

  // The target's own data — event JSON, kind registry entry, cached NIP text —
  // becomes the system prompt. Resolved through a live query so it picks up an
  // event or NIP that arrives after the window opens.
  // Always a context: without a target it is Hex's own instructions plus the
  // command catalogue, which every window needs.
  const context = useLiveQuery(
    () => buildAiContext(target),
    [target?.type, target?.value],
  );

  // Turns live in Dexie so a reload restores them with the window. `stored`
  // seeds the first render; after that local state owns them, so a streaming
  // reply is never fighting a query result.
  const stored = useLiveQuery(
    () => (storageId ? loadConversation(storageId) : Promise.resolve([])),
    [storageId],
  );
  const [local, setLocal] = useState<Turn[] | null>(null);
  // Memoized so `send`, which closes over it, is not rebuilt every render.
  const turns: Turn[] = useMemo(() => local ?? stored ?? [], [local, stored]);
  // The index is what a bare window shows until something is asked in it.
  const showIndex = isBare && turns.length === 0;
  const setTurns = useCallback(
    (update: (previous: Turn[]) => Turn[]) => {
      setLocal((previous) => update(previous ?? stored ?? []));
    },
    [stored],
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // The exact system prompt of the last send, so the disclosure shows what was
  // sent rather than what would be sent now.
  const [sentSystem, setSentSystem] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  /** Set when this pane is going away, so its own abort is not reported. */
  const tornDown = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Availability is read once: an injector that appears later is picked up on
  // the next send, which throws `unavailable` with the same message.
  // `isAnyInferenceReachable` also counts the browser's own model, so a user
  // with no extension is not told nothing can answer.
  const available = isAnyInferenceReachable();
  const injected = isInferenceAvailable();
  /** Bytes (or fraction) of the on-device model downloaded, while it is. */
  const [download, setDownload] = useState<number>();

  // Before the first send, mentions are unknown, so show the grounding that is
  // already decided. After, show exactly what went out.
  const disclosedSystem = sentSystem ?? system ?? context?.system;

  // A window grounded on an event previews it, so the conversation shows what
  // it is about rather than only naming it in a hidden prompt.
  const targetValue = target?.type === "event" ? target.value : undefined;
  const targetRef = useMemo(() => {
    if (!targetValue) return undefined;
    const ref = nostrRefTarget(targetValue);
    if (!ref) return undefined;
    if (ref.eventPointer || ref.addressPointer) return ref;
    // An npub or nprofile: preview the person through their kind 0, so a
    // profile question shows the profile the same way an event question shows
    // the event — the metadata renderer already exists.
    if (ref.pubkey) {
      return {
        ...ref,
        addressPointer: {
          kind: 0,
          pubkey: ref.pubkey,
          identifier: "",
          ...(ref.relays ? { relays: ref.relays } : {}),
        },
      };
    }
    return undefined;
  }, [targetValue]);

  // Which request function to use, and whether it takes tools. Standard first;
  // the experimental namespace only to gain tool calling.
  const toolSupport: ToolSupport = useMemo(
    () => (available ? resolveRequest().tools : "none"),
    [available],
  );
  const toolsEnabled = toolSupport !== "none";

  // The model that answered most recently, for the agent header. On the
  // on-device path nothing has answered yet but the model is already known.
  const lastModel = useMemo(
    () =>
      [...turns].reverse().find((turn) => turn.model !== undefined)?.model ??
      (injected ? undefined : PROMPT_API_MODEL),
    [injected, turns],
  );

  // `open_window` needs the window state, so it is built here; the read-only
  // executors are pure and live in the lib.
  const executors = useMemo(
    () =>
      createToolExecutors(async (args: unknown) => {
        const command = (args as { command?: unknown })?.command;
        if (typeof command !== "string") {
          return { error: "command must be a string." };
        }
        const refusal = refuseIfNeeded(command);
        if (refusal) return { error: refusal };
        const resolved = await resolveCommand(command, pubkey);
        addWindow(
          resolved.appId,
          resolved.props,
          resolved.commandString,
          resolved.customTitle,
        );
        return { opened: command, appId: resolved.appId };
      }),
    [addWindow, pubkey],
  );

  // Markdown element overrides for MessageResponse. Memoized because a new
  // object each render would defeat its memo and re-parse the whole reply.
  const markdownComponents = useMemo(() => {
    const onOpen = (target: NostrRefTarget, label: string) =>
      addWindow(target.appId, target.props, `open ${label}`);
    return {
      // A ```grimoire fence is a command proposal, not code to read. Render it
      // as buttons; anything else stays a normal code block.
      pre: ({ children, ...rest }: { children?: ReactNode }) => {
        const block = fencedBlock(children);
        if (block?.language === COMMAND_FENCE) {
          return <CommandChips block={block.code} />;
        }
        // Everything else goes through grimoire's code component, so it is
        // highlighted and copyable like code anywhere else in the app.
        return block ? (
          <ReplyCodeBlock code={block.code} language={block.language} />
        ) : (
          <pre className="max-w-full overflow-x-auto" {...rest}>
            {children}
          </pre>
        );
      },
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
      // Every other place a reference can land. Markdown only routes the tag it
      // renders through `components`, so a heading or a table cell that was not
      // listed here showed raw bech32 — the model puts npubs in both.
      ...Object.fromEntries(
        (
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "blockquote",
            "td",
            "th",
          ] as const
        ).map((tag) => [
          tag,
          ({ children, ...rest }: { children?: ReactNode }) => {
            const Tag = tag;
            return <Tag {...rest}>{withLinks(children, onOpen)}</Tag>;
          },
        ]),
      ),
    };
  }, [addWindow]);

  const send = useCallback(
    async (text: string) => {
      const priorMessages: InferenceMessage[] = turns
        .filter((turn) => !turn.pending)
        .map((turn) =>
          turn.role === "user"
            ? { role: "user" as const, content: turn.content }
            : {
                role: "assistant" as const,
                content: turn.content,
                ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
              },
        );

      setError(null);
      const at = Math.floor(Date.now() / 1000);
      setTurns((previous) => [
        ...previous,
        { role: "user", content: text, at },
        { role: "assistant", content: "", pending: true, at },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      // Resolve references named in the question — after the turn is on screen,
      // because this can wait on a relay. An explicit --system wins over the
      // target's context; mentions are additive to whichever applies.
      const mentions = await buildMentionContext(text);
      const systemPrompt =
        [system ?? context?.system, toolsSystem(toolsEnabled), mentions]
          .filter(Boolean)
          .join("\n\n") || undefined;
      setSentSystem(systemPrompt);
      const history: InferenceMessage[] = [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...priorMessages,
        { role: "user", content: text },
      ];

      // Accumulate off-state and flush on a frame so a token-per-render
      // stream does not thrash the tree.
      let content = "";
      let reasoningRounds: string[] = [];
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
                  ...(reasoningRounds.length ? { reasoningRounds } : {}),
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
      // Tool state changes are rare and worth showing immediately, so they
      // bypass the frame-batching that deltas need.
      const flushToolRuns = (runs: ToolRun[]) => {
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 && turn.pending
              ? { ...turn, toolRuns: runs.map((run) => ({ ...run })) }
              : turn,
          ),
        );
      };

      // The on-device model downloads on first use, which is large enough that
      // a silent wait reads as a hang.
      onModelDownloadProgress(setDownload);

      try {
        const loop = await runToolLoop({
          executors,
          messages: history,
          // Snapshots, not deltas: the loop drops the preamble a tool round
          // emits, so it owns the text and this only mirrors it.
          onDelta: (text) => {
            content = text;
            schedule();
          },
          onReasoningDelta: (rounds) => {
            reasoningRounds = rounds;
            schedule();
          },
          onToolRuns: flushToolRuns,
          request: resolveRequest().request,
          signal: controller.signal,
          ...(toolsEnabled ? { tools: AI_TOOLS } : {}),
        });
        content = loop.content;
        reasoningRounds = loop.reasoningRounds;
        model = loop.model;
        usage = loop.usage;
        const toolRuns = loop.toolRuns;

        // Rebuild from the turns we started with so earlier model and usage
        // survive; the placeholder is replaced, not patched.
        const settled: Turn[] = [
          ...turns.filter((turn) => !turn.pending),
          { role: "user", content: text, at },
          {
            role: "assistant",
            at: Math.floor(Date.now() / 1000),
            content,
            ...(reasoningRounds.some(Boolean) ? { reasoningRounds } : {}),
            ...(model ? { model } : {}),
            ...(usage ? { usage } : {}),
            ...(toolRuns.length ? { toolRuns } : {}),
          },
        ];
        setLocal(settled);
        // Save once the turn is settled, never mid-stream — a partial reply is
        // not worth a write per frame.
        if (storageId) void saveConversation(storageId, settled);
      } catch (caught) {
        // A turn the window itself cancelled is not an error worth reporting:
        // the request went away because this pane did, and in dev a Fast
        // Refresh runs the same cleanup, which read as "Request cancelled."
        // out of nowhere.
        if (!tornDown.current) setError(describeInferenceError(caught));
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
        onModelDownloadProgress(undefined);
        setDownload(undefined);
      }
    },
    [
      context?.system,
      executors,
      setTurns,
      system,
      toolsEnabled,
      turns,
      windowId,
    ],
  );

  // Closing the window must cancel in-flight provider work — a stream nobody
  // will read is still being paid for.
  useEffect(
    () => () => {
      tornDown.current = true;
      controllerRef.current?.abort();
    },
    [],
  );

  /**
   * Send the command-line prompt once. Guarded on the *stored* conversation
   * rather than a ref alone: windows are restored from localStorage, and the
   * only durable proof this prompt was already answered is that its turns came
   * back. `stored === undefined` means the query has not resolved yet.
   */
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current || !prompt || !available || stored === undefined) {
      return;
    }
    autoSent.current = true;
    if (stored.length > 0 || turns.length > 0) return;
    // Only an injector answers unprompted. Opening the on-device model can
    // start a download, which the browser only allows from a user gesture, so
    // the prompt waits in the composer for the click that qualifies.
    if (!injected) {
      setInput(prompt);
      return;
    }
    void send(prompt);
  }, [available, injected, prompt, send, stored, turns.length]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    void send(text);
  };

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <HexAvatar className="size-8" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{HEX_NAME} needs a provider</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Inference comes from an extension that injects{" "}
            <code className="text-xs">window.inference</code>. It keeps your API
            keys — grimoire never sees them, and asks nothing of them. This
            browser has no built-in model to fall back to either.
          </p>
          <a
            className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2 hover:text-primary/80"
            href="https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd"
            rel="noreferrer noopener"
            target="_blank"
          >
            Get Inference Bridge
            <ExternalLink className="size-3" />
          </a>
          <p className="text-xs text-muted-foreground">
            Reopen this window once it is installed.
          </p>
        </div>
      </div>
    );
  }

  // The composer leads on the index — a bare window is a place to start a
  // conversation — and trails a conversation, where it is a reply box.
  const composer = (
    <div className={cn("px-2 py-1", showIndex ? "border-b" : "border-t")}>
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
          placeholder={`Ask ${HEX_NAME}...`}
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {showIndex && composer}
      {/*
        `min-h-0` is load-bearing: a flex item defaults to min-height:auto, so
        Conversation would grow past the pane and the window's own overflow-auto
        would scroll instead. StickToBottom's scroller is height:100% of this
        element, so an unbounded height means it never scrolls — and never
        follows the stream.
      */}
      {/* `initial={false}` before the first turn: sticking to the bottom of a
          window where nothing has been said scrolls past the top of the event
          the question is about. Once there are turns, the newest is the point. */}
      <Conversation
        className="min-h-0"
        initial={turns.length > 0 ? "smooth" : false}
      >
        {/* The empty state centers itself in `size-full`, so the content box
            has to fill the pane — its default height is its content. */}
        <ConversationContent className={turns.length === 0 ? "h-full" : ""}>
          {/* What the model was actually told, before anything the user typed. */}
          {/* Configuration belongs to a conversation, not to the index: the
              bare page is a list, and nothing has been sent from it yet.
              Collapsed to its header, so the subject below it stays on the
              first screen. */}
          {!showIndex && (
            <AgentPanel
              className="shrink-0"
              instructions={disclosedSystem}
              model={lastModel}
              toolSupport={toolSupport}
              tools={AI_TOOLS}
            />
          )}
          {/* The event under discussion, rendered as itself — the question is
              about this, so it belongs in the conversation, not just the prompt.
              `shrink-0`, because the content box is a flex column that is
              `h-full` before the first turn: a shrinkable child gets squeezed to
              a sliver of the note it is supposed to show. */}
          {targetRef && (
            <EmbeddedEvent
              className="my-4 shrink-0 overflow-hidden rounded border border-muted"
              addressPointer={targetRef.addressPointer}
              eventPointer={targetRef.eventPointer}
            />
          )}
          {turns.length === 0 ? (
            // A bare `ai` window shows what Hex already remembers; a grounded
            // one shows openers for the thing it is grounded in.
            showIndex ? (
              <ConversationIndex currentWindowId={storageId} />
            ) : (
              // `h-auto flex-1`: takes the space left over rather than a full
              // height of its own, so it centers in what remains beside the
              // event above it instead of pushing it out of the pane.
              <ConversationEmptyState className="h-auto flex-1">
                {/* The event above says what this is about better than a line
                    naming its kind, so with a preview the copy is only the
                    openers. Without one, say what the window is. */}
                {!targetRef && (
                  <>
                    <HexAvatar className="size-8" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">
                        {context?.label
                          ? `Ask ${HEX_NAME} about ${context.label}`
                          : `Ask ${HEX_NAME}`}
                      </h3>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {context?.label
                          ? "Grounded in the local copy — no data leaves except the prompt."
                          : injected
                            ? "Your extension picks the provider and model."
                            : "No extension found, so this runs on the browser's own model — nothing leaves the machine. The first answer downloads it."}
                      </p>
                    </div>
                  </>
                )}
                {/* Openers, tailored to whatever this window is grounded in.
                    Clicking sends; nothing fires on its own. */}
                <Suggestions className="justify-center pt-2">
                  {(context?.suggestions ?? GENERAL_SUGGESTIONS).map(
                    (suggestion) => (
                      <Suggestion
                        key={suggestion}
                        onClick={(text) => {
                          if (streaming) return;
                          setInput("");
                          void send(text);
                        }}
                        suggestion={suggestion}
                      />
                    ),
                  )}
                </Suggestions>
              </ConversationEmptyState>
            )
          ) : (
            // A turn reads like every other message in grimoire: speaker,
            // relative time, content, separated by a rule — not a bubble.
            turns.map((turn, index) => (
              <div
                className={cn(
                  "flex flex-col gap-1 px-3 py-2",
                  // A question and its answer are one exchange; only the answer
                  // closes it with a rule.
                  turn.role === "assistant" && "border-b border-border/50",
                  "last:border-0",
                )}
                key={index}
              >
                <div className="flex flex-row items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-row items-baseline gap-2">
                    {turn.role === "assistant" ? (
                      <>
                        <HexAvatar
                          className="self-center"
                          face={turn.pending ? "working" : "idle"}
                        />
                        {turn.pending ? (
                          // Shimmer while he is thinking, so a long first token
                          // reads as thought rather than a stall.
                          <Shimmer
                            as="span"
                            className="font-medium"
                            duration={1.5}
                          >
                            {HEX_NAME}
                          </Shimmer>
                        ) : (
                          <span className="font-medium text-accent">
                            {HEX_NAME}
                          </span>
                        )}
                      </>
                    ) : pubkey ? (
                      <UserName className="font-medium" pubkey={pubkey} />
                    ) : (
                      <span className="font-medium">you</span>
                    )}
                    {turn.at !== undefined && !turn.pending && (
                      <span
                        className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                        title={formatTimestamp(turn.at, "absolute", locale)}
                      >
                        {formatTimestamp(turn.at, "relative", locale)}
                      </span>
                    )}
                  </div>
                  {/* Which model answered, and what it cost, beside the name
                      rather than trailing the reply. */}
                  {turn.role === "assistant" && !turn.pending && (
                    <TurnUsage
                      locale={locale}
                      model={turn.model}
                      usage={turn.usage}
                    />
                  )}
                </div>
                {/* Thinking and calls in the order they happened. A stored turn
                    from before rounds were kept has one block of reasoning. */}
                <TurnSteps
                  pending={turn.pending}
                  reasoningRounds={
                    turn.reasoningRounds ??
                    (turn.reasoning ? [turn.reasoning] : [])
                  }
                  toolRuns={turn.toolRuns ?? []}
                />
                <MessageResponse
                  className="max-w-full break-words"
                  components={markdownComponents}
                >
                  {turn.content}
                </MessageResponse>
              </div>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* A model download is minutes of nothing otherwise. */}
      {download !== undefined && (
        <div className="mx-4 mb-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Downloading the on-device model — {formatDownload(download)}. It is
          kept for next time.
        </div>
      )}

      {error && (
        <div className="mx-4 mb-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!showIndex && composer}
    </div>
  );
}
