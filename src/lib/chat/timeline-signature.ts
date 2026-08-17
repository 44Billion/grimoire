/**
 * What counts as "this timeline changed".
 *
 * A repaint with identical content still hands the virtualizer a fresh array,
 * which re-anchors the scroll, so a re-read that found nothing new has to be
 * silent. The cost of that dedupe is that anything left out of the signature is
 * a change the reader never sees — three separate bugs so far, one per field
 * that was missing.
 *
 * Every re-read of the same rows produces the same string: the store query is
 * ordered and the fold is pure, so no sorting or hashing is needed here, and
 * adding either would risk the false change this exists to prevent.
 */

import type { Message } from "@/types/chat";

export function timelineSignature(messages: readonly Message[]): string {
  return messages.map(fieldsOf).join(",");
}

/**
 * The fields whose change must repaint, for one message.
 *
 * - `delivery`: a queued message flipping "sending" → "failed" changes no id,
 *   and an id-only signature would swallow the repaint that tells the reader it
 *   did not go.
 * - `deleted`: a moderator's removal keeps the same id and timestamp, so a
 *   signature blind to it leaves the withheld content on screen.
 * - reaction ids: Concord's reactions are sealed inside wraps and folded into
 *   the message rather than arriving as their own row, so a reaction — anyone's,
 *   not just the viewer's — changes nothing else about the timeline. The ids
 *   rather than a count, because a remove and an add between two reads leave the
 *   count identical.
 */
function fieldsOf(message: Message): string {
  const reactions = message.metadata?.reactions;
  const reacted = reactions?.map((r) => r.id).join("+") ?? "";
  return `${message.id}:${message.delivery ?? ""}:${
    message.metadata?.deleted ? "x" : ""
  }:${reacted}`;
}
