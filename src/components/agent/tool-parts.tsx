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

import { Fragment } from "react";

import {
  BookText,
  CircleDot,
  GitPullRequest,
  GitMerge,
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

import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { KindBadge } from "@/components/KindBadge";
import { UserName } from "@/components/nostr/UserName";
import { RelayLink } from "@/components/nostr/RelayLink";
import { Label } from "@/components/ui/label";
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

/**
 * Most events one tool row draws.
 *
 * A model can read more than a pane can usefully show, and forty embeds inside
 * a collapsed row is a scroll nobody asked for. What is dropped is SAID rather
 * than silently trimmed — a prefix presented as the whole answer is how a
 * reader concludes a query returned less than it did.
 */
const MAX_EMBEDDED = 20;

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

/**
 * `ngit`'s own output, which is a terminal table rather than JSON.
 *
 * These tools shell out, so what comes back is what a maintainer would have
 * read on their own screen. Parsing it into rows is worth doing anyway: the id
 * is sixty-four characters of hex nobody reads, the status is the thing being
 * scanned for, and the title is the only part that says what it is.
 *
 * Anything that does not parse falls through to the raw text. `ngit` is not
 * ours and its output will change; a renderer that hid the parts it did not
 * recognise would silently stop showing them.
 */
interface Proposal {
  id: string;
  status: string;
  title: string;
}

function parseProposals(text: string): Proposal[] {
  const rows: Proposal[] = [];
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+(\S+)\s+(.*)$/.exec(line.trim());
    if (!match) continue;
    rows.push({
      id: match[1]!,
      status: match[2]!,
      // The label column trails the title; it is noise on a row this narrow.
      title: match[3]!.replace(/\s+#\S+\s*$/, "").trim(),
    });
  }
  return rows;
}

/** `open` is the one worth colouring; the rest are over and quiet. */
function proposalTone(status: string): string {
  if (status === "open") return "text-success";
  if (status === "draft") return "text-warning";
  return "text-muted-foreground";
}

function ProposalRows({ text }: { text: string }) {
  const rows = parseProposals(text);
  if (rows.length === 0) return undefined;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.id} className="flex items-baseline gap-2 text-xs">
          <span
            className={cn(
              "shrink-0 font-mono tabular-nums",
              proposalTone(row.status),
            )}
          >
            {row.status}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          {/* The id, short. Enough to name it back to the tool, not enough to
              take a line of its own. */}
          <span
            className="shrink-0 font-mono text-[10px] text-muted-foreground"
            title={row.id}
          >
            {row.id.slice(0, 8)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** `Subject: …` / `Author: …` — ngit's one-per-line header block. */
function parseFields(text: string): [string, string][] {
  const fields: [string, string][] = [];
  for (const line of text.split("\n")) {
    const match =
      /^(Subject|Author|Status|Branch|Labels|Comments):\s*(.+)$/.exec(
        line.trim(),
      );
    if (match) fields.push([match[1]!, match[2]!.trim()]);
  }
  return fields;
}

function ProposalDetail({ text }: { text: string }) {
  const fields = parseFields(text);
  if (fields.length === 0) return undefined;
  const npub = /npub1[0-9a-z]{20,}/.exec(text)?.[0];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {fields.map(([name, value]) => (
          <Fragment key={name}>
            <span className="text-muted-foreground">{name}</span>
            {/* An author is a person, and grimoire knows how to draw one. */}
            {name === "Author" && npub ? (
              <UserName pubkey={npub} className="min-w-0 truncate text-xs" />
            ) : (
              <span className="min-w-0 truncate font-mono">{value}</span>
            )}
          </Fragment>
        ))}
      </div>
      <Block>{text}</Block>
    </div>
  );
}

const PRESENTERS: Record<string, ToolPresenter> = {
  /**
   * `{repo}` → ngit's proposal table.
   *
   * The count goes on the row because that is the answer to "is there anything
   * to do", which is why anyone calls this.
   */
  git_proposals: {
    icon: GitPullRequest,
    summary: (args) => str(args.repo),
    outcome: (parsed) => {
      const text = typeof parsed === "string" ? parsed : undefined;
      if (text === undefined) return undefined;
      const open = parseProposals(text).filter((row) => row.status === "open");
      if (open.length === 0) return "nothing open";
      return `${open.length} open`;
    },
    detail: (parsed) =>
      typeof parsed === "string" ? <ProposalRows text={parsed} /> : undefined,
  },

  /** `{repo, id}` → one proposal's header block and description. */
  git_proposal: {
    icon: GitPullRequest,
    summary: (args) => {
      const id = str(args.id);
      const repo = str(args.repo);
      return id && repo ? `${repo} ${id.slice(0, 8)}` : (repo ?? id);
    },
    detail: (parsed) =>
      typeof parsed === "string" ? <ProposalDetail text={parsed} /> : undefined,
  },

  /**
   * `{repo, id}` → whatever ngit said about merging it.
   *
   * A merge publishes in the operator's name and does not push, so BOTH
   * outcomes matter to a reader: that it worked, and — far more often — the
   * sentence explaining why it did not. `ngit` refuses in prose ("has diverged
   * from the published proposal", "does not match the published PR tip"), and
   * that prose is the whole value of the row.
   */
  git_merge: {
    icon: GitMerge,
    summary: (args) => {
      const id = str(args.id);
      const repo = str(args.repo);
      return id && repo ? `${repo} ${id.slice(0, 8)}` : (repo ?? id);
    },
    detail: (parsed) =>
      typeof parsed === "string" ? <Block>{parsed}</Block> : undefined,
  },

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
  // the tool. Hex names its tools `chat.respond` internally, but a provider only
  // takes `^[a-zA-Z0-9_-]{1,64}$` and the runtime names a tool by its filename,
  // so what crosses the wire is `chat_respond` — the same underscore spelling
  // grimoire's own `ai` window uses. The dotted ids are the canonical contract
  // and never appear in a turn.

  /**
   * `{filters:[…]}` from grimoire's `ai` window; a flat NIP-01 filter from Hex.
   *
   * Two callers, one tool name, two argument shapes — so both are read rather
   * than one guessed. A summary that silently returns nothing for the other
   * caller's shape is how a row goes blank for reasons nobody can see.
   */
  nostr_req: {
    icon: Radio,
    summary: (args) =>
      describeFilters(args.filters ?? args.filter ?? [stripRelays(args)]),
    outcome: (parsed) => {
      const out = record(parsed);
      const returned = num(out?.returned) ?? countOf(out?.events);
      if (returned === undefined) return undefined;
      const matched = num(out?.matched);
      // "20 of 21" rather than "20": a limit that cut the answer short is the
      // single most useful thing to know about a query, and it is invisible
      // from the events themselves.
      return matched !== undefined && matched > returned
        ? `${returned} of ${matched} events`
        : `${returned} event${returned === 1 ? "" : "s"}`;
    },
    /**
     * The events, as events.
     *
     * A REQ's answer is a feed, and a feed rendered as JSON is a feed nobody
     * reads. Shared with the `git.*` tools, which return the same `events`
     * field for the same reason.
     */
    detail: (parsed) => <EventList parsed={parsed} />,
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
  nostr_resolve: {
    icon: Hash,
    summary: (args) => str(args.entity) ?? str(args.input),
    outcome: (parsed) => {
      const out = record(parsed);
      const tag = Array.isArray(out?.tag) ? out.tag : undefined;
      // The tag is the answer a model asked for this to get, so it is the
      // answer a reader gets too — one line, no click.
      return tag && typeof tag[0] === "string"
        ? `${tag[0]} ${shortKey(tag[1]) ?? ""}`.trim()
        : undefined;
    },
    detail: (parsed) => {
      const out = record(parsed);
      if (!out) return undefined;

      if (out.type === "profile") {
        const pubkey = str(out.pubkey);
        if (!pubkey) return undefined;
        return <PersonCard pubkey={pubkey} metadata={out.metadata} />;
      }

      const event = record(out.event);
      const id = str(event?.id);
      if (id)
        return (
          <EmbeddedEvent
            className="overflow-hidden rounded border border-muted"
            eventPointer={{
              id,
              kind: num(event?.kind),
              author: str(event?.pubkey),
            }}
          />
        );

      // An address that resolved to nothing still has an address, which is the
      // half a reader can act on.
      const address = str(out.address);
      return address ? (
        <code className="font-mono text-xs break-all">{address}</code>
      ) : undefined;
    },
  },

  /**
   * Who the agent is talking to.
   *
   * Rendered as the person rather than as their npub: a transcript is read by
   * someone who knows these people by name, and 64 hex characters is the one
   * representation that tells them nothing.
   */
  chat_who: {
    icon: User,
    detail: (parsed) => {
      const out = record(parsed);
      const pubkey = str(out?.pubkey);
      if (!pubkey) return undefined;
      const room = record(out?.room);
      return (
        <div className="flex flex-col gap-1">
          <PersonCard pubkey={pubkey} metadata={out?.metadata} />
          {room && (
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {str(room.transport) && (
                <Label size="sm">{str(room.transport)}</Label>
              )}
              {str(room.relay) && <RelayLink url={str(room.relay)!} />}
              {str(room.label) && <span>{str(room.label)}</span>}
            </div>
          )}
        </div>
      );
    },
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
  grimoire_help: {
    icon: BookText,
    summary: (args) => {
      const nip = str(args.nip);
      if (nip) return `NIP-${nip}`;
      const kind = num(args.kind);
      if (kind !== undefined) return `kind ${kind}`;
      return str(args.command) ?? str(args.topic);
    },
  },

  /** Opening a window is the one tool whose effect the reader can see. */
  run_command: {
    icon: SquareTerminal,
    summary: (args) => str(args.command),
  },

  /**
   * A NIP-34 repository, as work.
   *
   * These return the same `events` field a REQ does, deliberately, so they are
   * drawn by the same renderer. What they add is the part a raw query cannot
   * give: a state per thread, and the repository's own relays.
   */
  git_issues: {
    icon: CircleDot,
    summary: (args) => repoSummary(args),
    outcome: (parsed) => threadCount(parsed),
    detail: (parsed) => <EventList parsed={parsed} />,
  },
  git_patches: {
    icon: GitPullRequest,
    summary: (args) => repoSummary(args),
    outcome: (parsed) => threadCount(parsed),
    detail: (parsed) => <EventList parsed={parsed} />,
  },
  git_state: {
    icon: GitPullRequest,
    summary: (args) => {
      const state = str(args.state);
      const id = str(args.id);
      return state && id ? `${state} ${id.slice(0, 12)}…` : state;
    },
    outcome: (parsed) => {
      const out = record(parsed);
      // A status event from a non-maintainer publishes and does not count, and
      // the row says so rather than reading as a success.
      if (str(out?.warning)) return "published, but will not count";
      return str(out?.state);
    },
  },

  /** Speaking in a room. In a transcript this is the answer, not a tool. */
  chat_respond: { icon: MessageSquare, summary: (args) => str(args.text) },
  chat_react: { icon: MessageSquare, summary: (args) => str(args.emoji) },
};

/** The repository a `git.*` call names, short enough for one line. */
function repoSummary(args: Record<string, unknown>): string | undefined {
  const repo = str(args.repo);
  if (!repo) return undefined;
  // The identifier is the readable part; the pubkey in the middle is not.
  const identifier = repo.split(":")[2] ?? repo;
  const state = str(args.state);
  const kind = str(args.kind);
  return [identifier, state, kind === "any" ? undefined : kind]
    .filter(Boolean)
    .join(" · ");
}

/** `12 of 45 open`, when the tool said how many it left behind. */
function threadCount(parsed: unknown): string | undefined {
  const out = record(parsed);
  const returned = num(out?.returned) ?? countOf(out?.events);
  if (returned === undefined) return undefined;
  const matched = num(out?.matched);
  const state = str(out?.state);
  const suffix = state && state !== "any" ? ` ${state}` : "";
  return matched !== undefined && matched > returned
    ? `${returned} of ${matched}${suffix}`
    : `${returned}${suffix}`;
}

/** How many, when a count was not stated. */
function countOf(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * A person, from whatever the tool happened to know about them.
 *
 * `UserName` is the app's answer to "render a pubkey" everywhere else, and it
 * reads its own kind 0 — so the profile the tool fetched is used only for the
 * one line it may carry that the store does not: what they say about
 * themselves. A tool result is a snapshot of somebody else's relay read, and
 * where the two disagree the store is the fresher of the two.
 */
function PersonCard({
  pubkey,
  metadata,
}: {
  pubkey: string;
  metadata?: unknown;
}) {
  const profile = record(metadata);
  const about = str(profile?.about);
  return (
    <div className="flex flex-col gap-1 rounded border border-dotted border-border p-2">
      <UserName pubkey={pubkey} />
      {about && (
        <p className="line-clamp-3 text-xs text-muted-foreground">{about}</p>
      )}
    </div>
  );
}

/**
 * What the tool saw, while the real event is being fetched.
 *
 * Not a spinner: the tool's own copy has the kind, the author and the first
 * paragraph, and showing them beats showing nothing for the second or two an
 * embed takes — or forever, if no relay a reader can reach still holds it.
 */
function EventStub({
  event,
  index,
}: {
  event: Record<string, unknown> | undefined;
  index: number;
}) {
  const kind = num(event?.kind);
  const pubkey = str(event?.pubkey);
  const content = str(event?.content);
  return (
    <div className="flex flex-col gap-1 rounded border border-dotted border-border p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">
          {index + 1}
        </span>
        {kind !== undefined && <KindBadge kind={kind} variant="compact" />}
        {pubkey && <UserName pubkey={pubkey} className="text-xs" />}
      </div>
      {content && (
        <p className="line-clamp-3 text-muted-foreground">{content}</p>
      )}
    </div>
  );
}

/**
 * A tool result's `events`, rendered as the events they are.
 *
 * Shared by `nostr.req` and the `git.*` tools, which is why they all name the
 * field `events`: a reader that knows how to draw a REQ's answer should not
 * have to learn a second shape to draw a repository's issues.
 *
 * Embedded by id rather than reconstructed from the tool's copy — the copy is
 * truncated and unsigned, and grimoire already knows how to fetch and render an
 * event properly — with the relays the tool actually queried passed as hints,
 * since a reader's own relays very often do not hold them.
 */
function EventList({ parsed }: { parsed: unknown }) {
  const out = record(parsed);
  if (!out) return undefined;
  const events = Array.isArray(out.events) ? out.events : [];
  const relays = (Array.isArray(out.relays) ? out.relays : []).filter(
    (relay): relay is string => typeof relay === "string",
  );
  const filter = out.filter;

  if (events.length === 0 && !filter) return undefined;

  return (
    <div className="flex flex-col gap-2">
      {(filter !== undefined || relays.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {filter !== undefined && (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all">
              {JSON.stringify(filter)}
            </code>
          )}
          {relays.map((relay) => (
            <RelayLink key={relay} url={relay} />
          ))}
        </div>
      )}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing on those relays matched.
        </p>
      ) : (
        events.slice(0, MAX_EMBEDDED).map((entry, at) => {
          const event = record(entry);
          const id = str(event?.id);
          if (!id) return null;
          return (
            <EmbeddedEvent
              key={id}
              className="overflow-hidden rounded border border-muted"
              eventPointer={{
                id,
                kind: num(event?.kind),
                author: str(event?.pubkey),
                relays,
              }}
              // A pane can render fewer than a model can read; the row says
              // so below rather than silently showing a prefix.
              loadingFallback={<EventStub event={event} index={at} />}
            />
          );
        })
      )}
      {events.length > MAX_EMBEDDED && (
        <p className="text-xs text-muted-foreground">
          and {events.length - MAX_EMBEDDED} more
        </p>
      )}
    </div>
  );
}

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
/**
 * Hex's flat arguments as the NIP-01 filter they describe.
 *
 * Its tool takes the filter's fields directly, with tag filters under a `tags`
 * object rather than as `#`-prefixed keys, and a `relays` field that is routing
 * rather than filtering. Turned into the shape the describer already reads,
 * instead of teaching the describer a second grammar.
 */
function stripRelays(args: Record<string, unknown>): Record<string, unknown> {
  const { relays: _relays, tags, ...rest } = args;
  const tagged = record(tags);
  if (!tagged) return rest;
  return {
    ...rest,
    ...Object.fromEntries(
      Object.entries(tagged).map(([key, value]) => [`#${key}`, value]),
    ),
  };
}

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

/**
 * What a tool actually returned, out of the envelope it travelled in.
 *
 * Hex's tool bridge answers `{ok, output}` where `output` is a STRING — the
 * result rendered for the model to read — so a tool that returns JSON arrives
 * as JSON inside JSON. Parsing once got the envelope, whose `events` field does
 * not exist, so every rich renderer quietly declined and the reader got the
 * wall of text they were being spared. Unwrapped once here rather than in each
 * presenter, because the envelope is the transport's business and not the
 * tool's.
 */
function readOutput(raw: string): unknown {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const envelope = record(parsed);
  if (!envelope || typeof envelope.ok !== "boolean") return parsed;
  const inner = envelope.output;
  if (typeof inner !== "string") return parsed;
  try {
    return JSON.parse(inner);
  } catch {
    // A tool whose result is prose, wrapped. The envelope is all there is.
    return parsed;
  }
}

/** Everything this build knows how to present, for the tool directory. */
export const KNOWN_TOOL_NAMES = Object.keys(PRESENTERS);

function presenterFor(name: string): ToolPresenter {
  return PRESENTERS[name] ?? { icon: Wrench };
}

/** A row that opens. The chevron is the whole affordance; keep it quiet. */
/**
 * A tool call, wearing the `ai` window's chrome.
 *
 * ai-elements' `Tool` is what the `ai` window draws a call with — same border,
 * same collapse, same status badge — so a call read back in a transcript stops
 * looking like a different application from the same call watched live.
 *
 * What stays is this side's own contribution: a PRESENTER per tool, which turns
 * `nostr.req`'s output into event embeds and a NIP lookup into a badge rather
 * than showing everyone a wall of JSON. The chrome is shared; the body is not,
 * because only one of the two windows has published events to render.
 */
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
  const openable = Boolean(children);

  /**
   * The runtime's outcome, as ai-elements' state.
   *
   * A call with no result yet is `input-available`: the arguments are known and
   * the answer is not, which is what "running" means here.
   */
  const state = failed
    ? "output-error"
    : outcome === "running"
      ? "input-available"
      : "output-available";

  const header = (
    <ToolHeader
      state={state}
      toolName={name}
      type="dynamic-tool"
      icon={
        <Icon
          className={cn(
            "size-4 shrink-0",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        />
      }
      summary={
        summary ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {summary}
          </span>
        ) : undefined
      }
    />
  );

  // Nothing to open is not a disclosure. Rendered without the collapse rather
  // than with a control that does nothing when pressed.
  if (!openable) return <Tool>{header}</Tool>;

  return (
    <Tool>
      {header}
      <ToolContent className="space-y-2 p-3">{children}</ToolContent>
    </Tool>
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

  const parsed = readOutput(raw);

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
  const parsed = readOutput(raw);

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
