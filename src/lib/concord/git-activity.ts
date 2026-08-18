/**
 * A channel's git activity, as rows the chat timeline can carry.
 *
 * Pure: public NIP-34 events in, `Message` rows out. Fetching lives in
 * `services/concord-git-activity.ts` and rendering in ChatViewer; what is
 * decided here is WHICH activity belongs in a channel and how loudly.
 *
 * Three filters, each answering a way the feature turns hostile:
 *
 * - DETACHMENT ends a repository's claim on the channel: nothing written after
 *   it belongs. What came BEFORE the attachment does belong — a channel
 *   attached to a repository is about that repository, and the work that led up
 *   to the attachment is the context a new member most needs. Filtering to the
 *   interval instead showed nothing at all for the ordinary case: a channel
 *   created last week against a repository whose last patch landed in April;
 * - the LOADED WINDOW: a repository with three hundred issues would otherwise
 *   render as an issue tracker with chat sprinkled in, so a row must be no
 *   older than the oldest chat row on screen — except that a quiet repository
 *   would then never appear at all, so the newest {@link MIN_GIT_ROWS} are kept
 *   whatever their age. A channel showing no chat still shows no activity;
 * - a STATUS NEEDS ITS TICKET: "closed something" is noise. A status whose
 *   issue or patch is not in hand is dropped rather than rendered anonymously.
 */

import type { EventPointer } from "nostr-tools/nip19";

import {
  getIssueTitle,
  getPatchSubject,
  getPullRequestSubject,
  getStatusLabel,
  getStatusRootEventId,
  isStatusKind,
} from "@/lib/nip34-helpers";
import type { GitRepositoryAttachment } from "@/lib/concord/git";
import type { Message } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";

/** Most activity rows one timeline read will add, newest kept. */
export const MAX_GIT_ROWS = 50;

/**
 * Rows kept regardless of age, so a repository quieter than the conversation is
 * still visible. Below the loaded window they sort above the oldest chat row,
 * which is where they belong: earlier.
 */
export const MIN_GIT_ROWS = 5;

/** What a row says happened. */
export type GitActivityAction =
  | "opened issue"
  | "sent a patch"
  | "opened a pull request"
  | "opened"
  | "resolved"
  | "merged"
  | "closed"
  | "marked as draft"
  | "updated";

const TICKET_KINDS = new Set([1617, 1618, 1621]);

/** The `a` tags an event carries, as plain coordinates. */
function repositoryCoordinates(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "a" && typeof tag[1] === "string")
    .map((tag) => tag[1] as string);
}

/** A ticket's own words: the issue title, or the patch/PR subject. */
export function ticketSubject(event: NostrEvent): string | undefined {
  const subject =
    event.kind === 1621
      ? getIssueTitle(event)
      : event.kind === 1618
        ? getPullRequestSubject(event)
        : getPatchSubject(event);
  return subject?.trim() || undefined;
}

function ticketAction(kind: number): GitActivityAction {
  if (kind === 1621) return "opened issue";
  if (kind === 1618) return "opened a pull request";
  return "sent a patch";
}

/**
 * True when the event names a repository this channel is attached to, and was
 * not written after that attachment ended. Relays answer filters loosely, so
 * the `a` tag is re-checked here rather than trusted from the REQ.
 */
export function belongsToChannel(
  event: NostrEvent,
  attachments: readonly GitRepositoryAttachment[],
): boolean {
  const coordinates = new Set(repositoryCoordinates(event));
  return attachments.some(
    (attachment) =>
      coordinates.has(attachment.address.coordinate) &&
      (attachment.detachedAt === undefined ||
        event.created_at < attachment.detachedAt),
  );
}

function pointerOf(event: NostrEvent, relays: string[]): EventPointer {
  return {
    id: event.id,
    kind: event.kind,
    author: event.pubkey,
    ...(relays.length ? { relays } : {}),
  };
}

/** Relay hints from every attachment naming a repository this event carries. */
function hintsFor(
  event: NostrEvent,
  attachments: readonly GitRepositoryAttachment[],
): string[] {
  const coordinates = new Set(repositoryCoordinates(event));
  return [
    ...new Set(
      attachments
        .filter((a) => coordinates.has(a.address.coordinate))
        .flatMap((a) => a.relayHints),
    ),
  ];
}

/**
 * Fold public git events into timeline rows for one channel.
 *
 * `since` is the oldest chat row on screen: activity above it belongs to a page
 * the reader has not asked for. Pass `undefined` when there is no chat to
 * interleave with, and nothing is returned.
 */
export function gitActivityRows(
  events: readonly NostrEvent[],
  attachments: readonly GitRepositoryAttachment[],
  conversationId: string,
  since: number | undefined,
): Message[] {
  if (attachments.length === 0 || since === undefined) return [];

  const inChannel = events.filter((event) =>
    belongsToChannel(event, attachments),
  );
  // Tickets first, so a status in the same batch can find the one it names.
  const tickets = new Map(
    inChannel.filter((e) => TICKET_KINDS.has(e.kind)).map((e) => [e.id, e]),
  );

  const rows: Message[] = [];
  for (const event of inChannel) {
    const hints = hintsFor(event, attachments);
    if (TICKET_KINDS.has(event.kind)) {
      rows.push(
        row(event, conversationId, ticketAction(event.kind), hints, {
          ...(ticketSubject(event) ? { subject: ticketSubject(event)! } : {}),
        }),
      );
      continue;
    }
    if (!isStatusKind(event.kind)) continue;
    const rootId = getStatusRootEventId(event);
    const ticket = rootId ? tickets.get(rootId) : undefined;
    // A status whose ticket we do not hold names nothing the reader can follow.
    if (!ticket) continue;
    rows.push(
      row(
        event,
        conversationId,
        getStatusLabel(event.kind, ticket.kind === 1621) as GitActivityAction,
        hints,
        {
          ...(ticketSubject(ticket) ? { subject: ticketSubject(ticket)! } : {}),
          ticket: pointerOf(ticket, hints),
        },
      ),
    );
  }

  // Newest kept, then back into reading order: a clamp that dropped the RECENT
  // activity would leave the channel showing only what nobody is doing now.
  const ordered = rows.sort((a, b) => a.timestamp - b.timestamp);
  const onPage = ordered.filter((row) => row.timestamp >= since);
  const shown =
    onPage.length >= MIN_GIT_ROWS ? onPage : ordered.slice(-MIN_GIT_ROWS);
  return shown.slice(-MAX_GIT_ROWS);
}

function row(
  event: NostrEvent,
  conversationId: string,
  action: GitActivityAction,
  relays: string[],
  extra: { subject?: string; ticket?: EventPointer },
): Message {
  return {
    id: event.id,
    conversationId,
    author: event.pubkey,
    // The content string is what `groupSystemMessages` collapses on, so it
    // carries the subject: two different issues must never merge into one row
    // and lose their pointers with it.
    content: [action, extra.subject].filter(Boolean).join(" "),
    timestamp: event.created_at,
    type: "system" as const,
    metadata: {
      git: {
        action,
        pointer: pointerOf(event, relays),
        ...(extra.subject ? { subject: extra.subject } : {}),
        ...(extra.ticket ? { ticket: extra.ticket } : {}),
      },
    },
    protocol: "concord" as const,
    event,
  };
}
