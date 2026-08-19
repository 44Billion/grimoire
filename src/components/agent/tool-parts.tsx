/**
 * What a tool call looks like in a transcript.
 *
 * A transcript is READ, so a tool part is shown the way a person would describe
 * it — "ran npm test", "read vite.config.ts, 84 lines" — and the JSON is behind a
 * disclosure for when the summary is not enough. A row that leads with a blob of
 * arguments makes a session unreadable at exactly the length where reading it
 * matters.
 *
 * The registry is keyed by the tool's wire name. Those names are not ours to
 * choose: they are Eve's framework tools, taken from `eve@0.39.1` itself
 * (`runtime/framework-tools/*`), along with the field names each one uses. A tool
 * this build has never heard of — an authored tool from someone's `agent/tools/`
 * directory, a tool added in a later Eve — falls through to the generic row,
 * which is why the registry is a lookup and not a switch.
 *
 * Nothing here trusts its input. A tool result's `output` crosses the wire as a
 * string, so every renderer that wants structure parses it and falls back to
 * showing the text.
 */

import { useState } from "react";
import {
  BookText,
  ChevronRight,
  FileText,
  FolderSearch,
  Globe,
  Hash,
  MessageSquare,
  Pencil,
  Radio,
  Search,
  Sparkles,
  SquareTerminal,
  Terminal,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** A tool call as it appears in a turn. */
export interface ToolCallView {
  name: string;
  arguments: Record<string, unknown> | null;
  argumentsDigest?: string;
}

/** Its answer, whenever it arrives — usually the turn after. */
export interface ToolResultView {
  name: string;
  ok: boolean;
  output: string | null;
}

/**
 * How one tool is presented.
 *
 * `summary` gets the arguments and returns the line a reader sees. `detail` gets
 * the result and may return a node, or nothing to fall back to raw text.
 */
interface ToolPresenter {
  icon: LucideIcon;
  /** The call, in a sentence. Keep it short: this is a single line, unwrapped. */
  summary?: (args: Record<string, unknown>) => string | undefined;
  /** The result, laid out. Return undefined to use the plain-text fallback. */
  detail?: (parsed: unknown, raw: string) => React.ReactNode | undefined;
  /** A one-line answer, shown on the row itself rather than behind a click. */
  outcome?: (parsed: unknown) => string | undefined;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The last two segments of a path — enough to recognise, short enough to read. */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A scrolling block of preformatted text, which most tool output is. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap">
      {children}
    </pre>
  );
}

const PRESENTERS: Record<string, ToolPresenter> = {
  /** `{command}` → `{exitCode, stdout, stderr, truncated}`. */
  bash: {
    icon: Terminal,
    summary: (args) => str(args.command),
    outcome: (parsed) => {
      const out = record(parsed);
      const code = num(out?.exitCode);
      if (code === undefined) return undefined;
      return code === 0 ? "exit 0" : `exit ${code}`;
    },
    detail: (parsed) => {
      const out = record(parsed);
      if (!out) return undefined;
      const stdout = str(out.stdout);
      const stderr = str(out.stderr);
      if (!stdout && !stderr) return <Block>(no output)</Block>;
      return (
        <div className="flex flex-col gap-1">
          {stdout && <Block>{stdout}</Block>}
          {stderr && (
            <div className="border-l-2 border-destructive/60 pl-2">
              <Block>{stderr}</Block>
            </div>
          )}
        </div>
      );
    },
  },

  /** `{filePath, offset?, limit?}` → `{content, path, totalLines, truncated}`. */
  read_file: {
    icon: FileText,
    summary: (args) => {
      const path = str(args.filePath);
      if (!path) return undefined;
      const from = num(args.offset);
      return from ? `${shortPath(path)} from line ${from}` : shortPath(path);
    },
    outcome: (parsed) => {
      const lines = num(record(parsed)?.totalLines);
      return lines === undefined ? undefined : `${lines} lines`;
    },
    detail: (parsed) => {
      const content = str(record(parsed)?.content);
      return content ? <Block>{content}</Block> : undefined;
    },
  },

  /** `{filePath, content}` → `{existed, path}`. */
  write_file: {
    icon: Pencil,
    summary: (args) => {
      const path = str(args.filePath);
      if (!path) return undefined;
      const bytes = str(args.content)?.length;
      return bytes ? `${shortPath(path)} (${bytes} bytes)` : shortPath(path);
    },
    outcome: (parsed) => {
      const out = record(parsed);
      if (out?.existed === undefined) return undefined;
      return out.existed ? "replaced" : "created";
    },
    // The content is the argument here, not the result, so the call's own
    // disclosure already holds it.
    detail: () => undefined,
  },

  /** `{pattern, path?}` → `{content, count, truncated}`. */
  glob: {
    icon: FolderSearch,
    summary: (args) => str(args.pattern),
    outcome: (parsed) => {
      const count = num(record(parsed)?.count);
      return count === undefined
        ? undefined
        : `${count} file${count === 1 ? "" : "s"}`;
    },
    detail: (parsed) => {
      const content = str(record(parsed)?.content);
      return content ? <Block>{content}</Block> : undefined;
    },
  },

  /** `{pattern, path?, glob?}` → `{content, matchCount, truncated}`. */
  grep: {
    icon: Search,
    summary: (args) => {
      const pattern = str(args.pattern);
      if (!pattern) return undefined;
      const where = str(args.glob) ?? str(args.path);
      return where ? `${pattern} in ${shortPath(where)}` : pattern;
    },
    outcome: (parsed) => {
      const count = num(record(parsed)?.matchCount);
      return count === undefined
        ? undefined
        : `${count} match${count === 1 ? "" : "es"}`;
    },
    detail: (parsed) => {
      const content = str(record(parsed)?.content);
      return content ? <Block>{content}</Block> : undefined;
    },
  },

  /** No published schema; the query is what a reader wants either way. */
  web_search: {
    icon: Globe,
    summary: (args) => str(args.query) ?? str(args.q),
  },

  load_skill: {
    icon: Sparkles,
    summary: (args) => str(args.name) ?? str(args.skill),
  },

  // ── grimoire's and Hex's own tools ──────────────────────────────────────────
  //
  // The same registry, because a transcript does not care which runtime called
  // the tool: `nostr_req` is grimoire's `ai` window, `nostr.req` is Hex's, and
  // both mean a REQ a reader wants summarised as a filter rather than as JSON.
  // Both spellings are listed rather than normalised — a tool id is a contract,
  // and guessing that a dot and an underscore are the same tool is how a renderer
  // starts lying about what ran.

  /** `{filters:[…]}` — one or more NIP-01 filters, OR'd. */
  nostr_req: { icon: Radio, summary: (args) => describeFilters(args.filters) },
  "nostr.req": {
    icon: Radio,
    summary: (args) => describeFilters(args.filters ?? args.filter),
  },

  /** `{pubkey}` → a kind 0. */
  fetch_profile: { icon: User, summary: (args) => shortKey(args.pubkey) },

  /** `{id}` or `{kind, pubkey, identifier?}`. */
  fetch_event: {
    icon: Hash,
    summary: (args) => {
      const id = str(args.id);
      if (id) return `${id.slice(0, 12)}…`;
      const kind = num(args.kind);
      const author = shortKey(args.pubkey);
      if (kind === undefined) return undefined;
      const d = str(args.identifier);
      return `kind ${kind}${author ? ` by ${author}` : ""}${d ? ` '${d}` : ""}`;
    },
  },

  /** A bech32 entity turned into what it names. */
  decode_bech32: { icon: Hash, summary: (args) => str(args.input) },
  "nostr.resolve": {
    icon: Hash,
    summary: (args) => str(args.input) ?? str(args.entity),
  },

  encode_nevent: { icon: Hash, summary: (args) => shortKey(args.id) },
  encode_naddr: {
    icon: Hash,
    summary: (args) => {
      const kind = num(args.kind);
      const d = str(args.identifier);
      return kind === undefined
        ? undefined
        : `kind ${kind}${d ? ` '${d}` : ""}`;
    },
  },
  encode_profile: { icon: User, summary: (args) => shortKey(args.pubkey) },

  resolve_nip05: {
    icon: User,
    summary: (args) => str(args.identifier) ?? str(args.nip05),
  },
  fetch_relay_info: { icon: Radio, summary: (args) => str(args.url) },

  /** A NIP, read rather than recalled. */
  download_nip: {
    icon: BookText,
    summary: (args) => {
      const nip = str(args.nip) ?? num(args.nip)?.toString();
      return nip ? `NIP-${nip}` : undefined;
    },
  },
  get_nip_index: { icon: BookText },
  "grimoire.help": {
    icon: BookText,
    summary: (args) => str(args.topic) ?? str(args.nip) ?? str(args.kind),
  },

  /** Opening a window is the one tool whose effect the reader can see. */
  run_command: {
    icon: SquareTerminal,
    summary: (args) => str(args.command),
  },

  /** Speaking in a room. In a transcript this is the answer, not a tool. */
  "chat.respond": { icon: MessageSquare, summary: (args) => str(args.text) },
  "chat.react": { icon: MessageSquare, summary: (args) => str(args.emoji) },
};

/** A pubkey short enough to sit on one line and still be recognisable. */
function shortKey(value: unknown): string | undefined {
  const key = str(value);
  if (!key) return undefined;
  return key.length > 20 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}

/**
 * A REQ as a person would say it: `kinds 1,30023 by 3 authors, limit 50`.
 *
 * A filter printed as JSON is the single worst offender in an unreadable
 * transcript — it is long, it is mostly punctuation, and the parts that matter
 * are three words.
 */
function describeFilters(value: unknown): string | undefined {
  const filters = Array.isArray(value) ? value : value ? [value] : [];
  const described = filters
    .map((entry) => {
      const filter = record(entry);
      if (!filter) return undefined;
      const parts: string[] = [];
      const kinds = filter.kinds;
      if (Array.isArray(kinds) && kinds.length > 0)
        parts.push(`kind${kinds.length === 1 ? "" : "s"} ${kinds.join(",")}`);
      const authors = filter.authors;
      if (Array.isArray(authors) && authors.length > 0)
        parts.push(
          authors.length === 1
            ? `by ${shortKey(authors[0])}`
            : `by ${authors.length} authors`,
        );
      const ids = filter.ids;
      if (Array.isArray(ids) && ids.length > 0)
        parts.push(`${ids.length} id${ids.length === 1 ? "" : "s"}`);
      for (const [key, tagged] of Object.entries(filter))
        if (key.startsWith("#") && Array.isArray(tagged) && tagged.length > 0)
          parts.push(
            `${key} ${tagged.length === 1 ? shortKey(tagged[0]) : tagged.length}`,
          );
      const limit = num(filter.limit);
      if (limit !== undefined) parts.push(`limit ${limit}`);
      return parts.join(" ") || "everything";
    })
    .filter(Boolean);
  if (described.length === 0) return undefined;
  return described.join(" | ");
}

/** Everything this build knows how to present, for the tool directory. */
export const KNOWN_TOOL_NAMES = Object.keys(PRESENTERS);

function presenterFor(name: string): ToolPresenter {
  return PRESENTERS[name] ?? { icon: Wrench };
}

/** A row that opens. The chevron is the whole affordance; keep it quiet. */
function Disclosure({
  icon: Icon,
  name,
  summary,
  outcome,
  failed,
  children,
}: {
  icon: LucideIcon;
  name: string;
  summary?: string;
  outcome?: string;
  failed?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openable = Boolean(children);

  return (
    <div className="rounded border border-dotted border-border">
      <button
        type="button"
        disabled={!openable}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs",
          openable && "hover:bg-muted/50",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            !openable && "opacity-0",
            open && "rotate-90",
          )}
        />
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        />
        <span className="shrink-0 font-mono text-foreground">{name}</span>
        {summary && (
          <span className="truncate font-mono text-muted-foreground">
            {summary}
          </span>
        )}
        {outcome && (
          <span
            className={cn(
              "ml-auto shrink-0 font-mono",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {outcome}
          </span>
        )}
        {failed && !outcome && (
          <span className="ml-auto shrink-0 font-mono text-destructive">
            failed
          </span>
        )}
      </button>
      {open && children && (
        <div className="border-t border-dotted border-border px-2 py-1">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A call and its answer, as one row.
 *
 * This is the shape a reader wants: what was asked, and how it went, on one line
 * — `bash npm run test:run  exit 0` — with both the arguments and the output
 * behind the same disclosure. The wire had to publish them as two turns, because
 * the answer did not exist when the call was made; that is the wire's problem,
 * not the page's.
 *
 * A call with no result yet renders as itself. That is either a session still
 * running or a chain with a hole in it, and both are better shown than hidden.
 */
export function ToolExchangeRow({
  item,
}: {
  item: {
    kind: "tool";
    id: string;
    name: string;
    arguments: Record<string, unknown> | null;
    argumentsDigest?: string;
    result?: {
      ok: boolean;
      output: string | null;
      truncated?: { bytes: number; sha256: string };
      ref?: { url: string; size: number; sha256: string };
    };
  };
}) {
  const presenter = presenterFor(item.name);
  const args = item.arguments;
  const summary = args ? presenter.summary?.(args) : undefined;
  const raw = item.result?.output ?? "";

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  const failed = item.result ? !item.result.ok : false;
  const outcome = item.result
    ? failed
      ? "failed"
      : (presenter.outcome?.(parsed) ?? "done")
    : "running";

  const detail = item.result ? presenter.detail?.(parsed, raw) : undefined;

  return (
    <Disclosure
      icon={presenter.icon}
      name={item.name}
      summary={
        summary ?? (args === null ? "arguments too large to carry" : undefined)
      }
      outcome={outcome}
      failed={failed}
    >
      <div className="flex flex-col gap-2">
        {args === null ? (
          <Block>
            {item.argumentsDigest
              ? `arguments not carried; sha256 ${item.argumentsDigest}`
              : "arguments not carried"}
          </Block>
        ) : Object.keys(args).length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
              arguments
            </span>
            <Block>{JSON.stringify(args, null, 2)}</Block>
          </div>
        ) : null}

        {item.result && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
              {failed ? "error" : "output"}
            </span>
            {detail ?? <Block>{raw || "(no output)"}</Block>}
            {item.result.truncated && (
              <span className="text-[10px] text-muted-foreground">
                {item.result.truncated.bytes} bytes truncated
              </span>
            )}
            {item.result.ref && (
              <a
                href={item.result.ref.url}
                target="_blank"
                rel="noreferrer"
                className="w-fit text-[10px] text-muted-foreground underline"
              >
                full output ({item.result.ref.size} bytes)
              </a>
            )}
          </div>
        )}
      </div>
    </Disclosure>
  );
}

export function ToolCallRow({ call }: { call: ToolCallView }) {
  const presenter = presenterFor(call.name);
  const args = call.arguments;
  const summary = args ? presenter.summary?.(args) : undefined;

  return (
    <Disclosure
      icon={presenter.icon}
      name={call.name}
      summary={
        summary ??
        (args === null
          ? "arguments too large to carry"
          : Object.keys(args).length > 0
            ? undefined
            : "no arguments")
      }
    >
      {args === null ? (
        <Block>
          {call.argumentsDigest
            ? `arguments not carried; sha256 ${call.argumentsDigest}`
            : "arguments not carried"}
        </Block>
      ) : Object.keys(args).length > 0 ? (
        <Block>{JSON.stringify(args, null, 2)}</Block>
      ) : undefined}
    </Disclosure>
  );
}

export function ToolResultRow({ result }: { result: ToolResultView }) {
  const presenter = presenterFor(result.name);
  const raw = result.output ?? "";

  // Hex sends a tool's output as text, whatever shape it had. Parsing it back is
  // best effort by design: a tool that answers in prose is not a broken tool.
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  const detail = presenter.detail?.(parsed, raw);
  const body =
    detail ?? (raw ? <Block>{raw}</Block> : <Block>(no output)</Block>);

  return (
    <Disclosure
      icon={presenter.icon}
      name={result.name}
      outcome={result.ok ? presenter.outcome?.(parsed) : undefined}
      failed={!result.ok}
    >
      {body}
    </Disclosure>
  );
}
