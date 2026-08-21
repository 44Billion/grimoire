/**
 * The one name a private conversation answers to.
 *
 * A NIP-17 conversation IS its participant set — the `p` tags decide where a
 * message is filed — so the id has to be derived the same way everywhere: the
 * viewer plus everyone named, deduped, sorted, colon-joined.
 *
 * Both forms arrive. A 1:1 is opened by naming one person; a group arrives as
 * the id the sidebar already holds, or as the participants a compose dialog
 * just picked. Anything that collapses a group to a single peer files it under
 * a conversation that has no rows — which is how a sidebar row with an unread
 * badge opened to an empty timeline.
 */

import { createConversationIdentifier } from "applesauce-common/helpers/messages";

/** One pubkey, or an already-joined id, normalised to the canonical id. */
export function dmConversationIdFor(self: string, peerOrId: string): string {
  return createConversationIdentifier([
    self,
    ...peerOrId.split(":").filter(Boolean),
  ]);
}

/** Everyone in a conversation except the viewer. Empty for a note to self. */
export function dmOthersIn(conversationId: string, self: string): string[] {
  return conversationId.split(":").filter((p) => p && p !== self);
}
