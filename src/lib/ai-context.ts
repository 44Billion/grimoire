import type { NostrEvent } from "nostr-tools";
import { firstValueFrom, take, timeout } from "rxjs";

import {
  nostrRefTarget,
  splitNostrRefs,
  type NostrRefTarget,
} from "./open-nostr-ref";

import { COMMAND_FENCE, PROPOSAL_DENIED } from "./ai-commands";
import type { AiTarget } from "./ai-target";

import { getKindInfo } from "@/constants/kinds";
import { manPages } from "@/types/man";
import db from "@/services/db";
import eventStore from "@/services/event-store";
import { addressLoader, eventLoader } from "@/services/loaders";
import { getNipText } from "@/services/nip-text";

/**
 * Context for an `ai` window, built from what grimoire already holds.
 *
 * The point of asking a model inside a Nostr explorer is that the object under
 * discussion is already resident — in the EventStore, in the kind registry, in
 * the cached NIP text. No retrieval layer, no embeddings: name the thing and
 * its own data goes in the prompt.
 */
export interface AiContext {
  /** Prepended as the system message. */
  system: string;
  /** Short label for what this window is grounded in, if anything. */
  label?: string;
  /** Opening questions offered before the first turn. */
  suggestions: string[];
}

/**
 * Openers for an ungrounded window. Each one is answerable without any Nostr
 * data, so none of them wastes a request discovering it has no context.
 */
export const GENERAL_SUGGESTIONS = [
  "What problem does Nostr actually solve?",
  "Explain relays like I run one",
  "What is a replaceable event?",
  "How do NIP-05 identifiers work?",
];

export type { AiTarget, AiTargetKind } from "./ai-target";
export { parseAiTarget } from "./ai-target";

/**
 * The commands a model may propose, with their flags.
 *
 * Synopsis alone was not enough: asked how to read highlights from contacts,
 * Hex invented a relay URL and a `<contact-pubkey>` placeholder because it could
 * not know `req` takes `-a $contacts`. Flags are listed by name only — the
 * descriptions would be several thousand tokens for no extra decision power.
 */
function commandCatalogue(): string {
  return Object.values(manPages)
    .filter((page) => !PROPOSAL_DENIED.has(page.appId))
    .map((page) => {
      const flags = (page.options ?? [])
        .map((option) => option.flag)
        .filter((flag) => flag.startsWith("-"))
        .join(" ");
      const summary = page.description.split(".")[0];
      return `  ${page.synopsis}${flags ? `\n    flags: ${flags}` : ""}\n    ${summary}.`;
    })
    .join("\n");
}

const BASE_SYSTEM = [
  "You are Hex, the assistant inside grimoire — a Nostr protocol explorer whose" +
    " windows are opened by Unix-style commands. Answer as Hex, concretely and" +
    " briefly, and do not introduce yourself unless asked.",
  "Cite kind numbers and NIP ids where they apply, and reference people and" +
    " events by their `nostr:` bech32 entity so they render as profiles and" +
    " embedded events. Never invent one: an entity that does not decode renders" +
    " as dead text. Same for relay URLs, pubkeys and event ids.",
  "Never state a spec detail as fact when its text is not in front of you; say" +
    " you are answering from memory instead.",
  `Commands available:\n${commandCatalogue()}`,
].join("\n\n");

/** How to write a command the user runs, rather than one Hex runs. */
const PROPOSAL_RULES =
  "A command the user should run goes in a fenced block whose language is" +
  ` exactly \`${COMMAND_FENCE}\`, one per line, with a sentence saying what it` +
  " shows — that fence is what makes it a button, and an unlabelled fence is" +
  " just text. Write it so it runs as typed: `$me` and `$contacts` instead of" +
  " placeholder pubkeys, and no relay unless the user named one, because" +
  " grimoire selects relays itself via NIP-65.";

/**
 * Appended when the provider takes tools, replaced by a plainer rule when it
 * does not. Both halves are needed: with tools Hex opens windows and runs REQs
 * itself, and without them a claim to have opened anything is a lie.
 */
const TOOLS_SYSTEM = [
  "You have tools, and they beat recall. `lookup_spec` returns a NIP's text, a" +
    " kind's definition, or a command's manual page with its flags described." +
    " `query_nostr` runs a REQ and hands you the events. `open_window` runs a" +
    " read-only command. Read before you write: a command you are unsure of has" +
    " a manual page, and a question about the network has events behind it.",
  "`query_nostr` takes a whole NIP-01 filter — ids, authors, kinds, since," +
    " until, search, and single-letter tags — so narrow the query instead of" +
    " fetching kind 1 and sorting it in your head. `$me` and `$contacts` work in" +
    " `authors` and in the `p` tag. Answer from what came back, quoting it.",
  // Every npub in one reply was invented from the hex the tool returned, and
  // every one of them failed its checksum and rendered as dead text.
  "Each returned event carries an `npub` and an `nevent`. Use those exact" +
    " strings; never build bech32 out of a hex id or pubkey.",
  'A thread is the events tagging its root — `{"e": ["<id>"]}` — so read it' +
    " rather than guessing at the replies. To hand it over, `chat <nevent>`" +
    " opens the discussion (NIP-10 replies for kind 1, NIP-22 comments" +
    " otherwise), which beats `open` when they want to read it.",
  `Open a window yourself only when the user asked for one. ${PROPOSAL_RULES}`,
  "Never claim to have opened something no tool reported opening.",
].join("\n\n");

const NO_TOOLS_SYSTEM = [
  "You cannot run anything yourself and must not claim to have opened" +
    " anything — the user clicks to run it.",
  PROPOSAL_RULES,
].join("\n\n");

/**
 * The tool half of the prompt. Separate because tool support is only known at
 * send time — the injector may advertise none.
 */
export function toolsSystem(enabled: boolean): string {
  return enabled ? TOOLS_SYSTEM : NO_TOOLS_SYSTEM;
}

/**
 * Hex's own instructions, with no object attached. Every window gets these —
 * an ungrounded chat still needs to know who it is and which commands exist.
 */
export function baseContext(): AiContext {
  return { system: BASE_SYSTEM, suggestions: GENERAL_SUGGESTIONS };
}

/** Build the system prompt for a target, falling back to the base context. */
export async function buildAiContext(target?: AiTarget): Promise<AiContext> {
  if (!target) return baseContext();
  switch (target.type) {
    case "event":
      return eventContext(target.value);
    case "kind":
      return kindContext(Number(target.value));
    case "nip":
      return nipContext(target.value);
    default:
      return baseContext();
  }
}

/** Kinds whose replies hang off an `e` tag, so a thread can be gathered. */
const THREADED_KINDS = new Set([1, 11, 1111, 1244, 9802]);

async function eventContext(bech32: string): Promise<AiContext> {
  const ref = nostrRefTarget(bech32);
  if (!ref) return baseContext();

  // A profile: the pubkey plus whatever metadata is cached.
  if (ref.pubkey) {
    const profile = await db.profiles.get(ref.pubkey).catch(() => undefined);
    const described = profile
      ? JSON.stringify(profile, null, 2)
      : "(no cached profile metadata)";
    return {
      label: bech32.slice(0, 12),
      system: `${BASE_SYSTEM}\n\nThe user is asking about this Nostr user.\nPubkey: ${ref.pubkey}\nProfile metadata:\n${described}`,
      suggestions: [
        "Who is this, from their metadata?",
        "What can I tell about them from this alone?",
        "What is missing from this profile?",
      ],
    };
  }

  const event = await resolveEvent(ref);
  if (!event) {
    return {
      label: bech32.slice(0, 12),
      system: `${BASE_SYSTEM}\n\nThe user is asking about ${bech32}, which could not be loaded from the event store or its relay hints. Say so rather than guessing its contents.`,
      suggestions: ["Why might this event be unreachable?"],
    };
  }

  return {
    label: `kind ${event.kind}`,
    system: `${BASE_SYSTEM}\n\nThe user is asking about this event.\n${describeKind(event.kind)}\n\nRaw event:\n${JSON.stringify(event, null, 2)}`,
    suggestions: [
      "Summarize this",
      // Only where a thread exists: the replies are fetchable with an `e` tag
      // filter, so this is an opener Hex can actually answer.
      ...(THREADED_KINDS.has(event.kind) ? ["Summarize this thread"] : []),
      "Translate this to English",
      "What do its tags mean?",
      `Why kind ${event.kind} and not something else?`,
    ],
  };
}

function describeKind(kind: number): string {
  const info = getKindInfo(kind);
  return info
    ? `Kind ${kind} is "${info.name}" (${info.nip}): ${info.description}`
    : `Kind ${kind} is not in grimoire's kind registry, so it is either new, experimental, or application-specific.`;
}

async function kindContext(kind: number): Promise<AiContext> {
  if (!Number.isFinite(kind)) return baseContext();
  const nipText = await nipTextForKind(kind);
  return {
    label: `kind ${kind}`,
    system: `${BASE_SYSTEM}\n\nThe user is asking about event kind ${kind}.\n${describeKind(kind)}${
      nipText ? `\n\nThe NIP that defines it:\n${nipText}` : ""
    }`,
    suggestions: [
      `What is kind ${kind} for?`,
      "Show me a minimal example event",
      "Which tags are required?",
      "Is it regular, replaceable, or addressable?",
    ],
  };
}

async function nipTextForKind(kind: number): Promise<string | undefined> {
  const info = getKindInfo(kind);
  if (!info?.nip) return undefined;
  const id = info.nip.replace(/^nip-?/i, "").toUpperCase();
  return nipText(id);
}

async function nipContext(id: string): Promise<AiContext> {
  const text = await nipText(id);
  return {
    label: `NIP-${id}`,
    system: text
      ? `${BASE_SYSTEM}\n\nThe user is asking about NIP-${id}. Its full text:\n${text}`
      : `${BASE_SYSTEM}\n\nThe user is asking about NIP-${id}, whose text could not be loaded. Say plainly that you are answering from memory rather than from the spec.`,
    suggestions: [
      `What problem does NIP-${id} solve?`,
      "Which event kinds does it define?",
      "What would I get wrong implementing this?",
      "How does it interact with other NIPs?",
    ],
  };
}

/** Most references resolved for one message. A prompt is not a crawl. */
const MAX_MENTIONS = 3;
/** Per-event budget. A long-form article can be tens of thousands of chars. */
const MENTION_CHARS = 4_000;
/** A relay that never answers must not hold the send open. */
const RESOLVE_TIMEOUT = 6_000;

/**
 * Context for references named inside the question itself.
 *
 * Asking "what does <nevent> say?" only works if the event travels with the
 * question. Resolves from the EventStore first and the network second, so a
 * mention costs a fetch only when grimoire has not already seen it.
 */
export async function buildMentionContext(
  text: string,
): Promise<string | undefined> {
  const seen = new Set<string>();
  const targets: NostrRefTarget[] = [];

  for (const segment of splitNostrRefs(text)) {
    const target = segment.target;
    if (!target || seen.has(segment.text)) continue;
    seen.add(segment.text);
    targets.push(target);
    if (targets.length >= MAX_MENTIONS) break;
  }

  if (targets.length === 0) return undefined;

  const described = await Promise.all(targets.map(describeTarget));
  const blocks = described.filter((block): block is string => block != null);
  return blocks.length > 0
    ? `The question references these Nostr objects. Use them rather than guessing.\n\n${blocks.join("\n\n")}`
    : undefined;
}

async function describeTarget(
  target: NostrRefTarget,
): Promise<string | undefined> {
  if (target.pubkey) {
    const profile = await db.profiles.get(target.pubkey).catch(() => undefined);
    return `User ${target.pubkey}:\n${
      profile
        ? truncate(JSON.stringify(profile, null, 2))
        : "(no cached profile metadata)"
    }`;
  }

  const event = await resolveEvent(target);
  if (!event) {
    return `A referenced event could not be loaded. Say so rather than inventing its contents.`;
  }
  return `${describeKind(event.kind)}\n${truncate(JSON.stringify(event, null, 2))}`;
}

/** EventStore first, relays second. Undefined rather than throwing on failure. */
async function resolveEvent(
  target: NostrRefTarget,
): Promise<NostrEvent | undefined> {
  const pointer = target.eventPointer ?? target.addressPointer;
  if (!pointer) return undefined;

  const cached = (() => {
    try {
      return eventStore.getEvent(pointer);
    } catch {
      return undefined;
    }
  })();
  if (cached) return cached;

  const loader = target.eventPointer
    ? eventLoader(target.eventPointer)
    : addressLoader(target.addressPointer!);

  try {
    return await firstValueFrom(loader.pipe(timeout(RESOLVE_TIMEOUT), take(1)));
  } catch {
    return undefined;
  }
}

function truncate(text: string): string {
  return text.length > MENTION_CHARS
    ? `${text.slice(0, MENTION_CHARS)}\n[truncated]`
    : text;
}

/** NIP body, truncated: a whole NIP can outweigh a small context window. */
async function nipText(id: string): Promise<string | undefined> {
  const content = await getNipText(id);
  if (!content) return undefined;
  const LIMIT = 24_000;
  return content.length > LIMIT
    ? `${content.slice(0, LIMIT)}\n\n[truncated]`
    : content;
}
