import type { NostrEvent } from "nostr-tools";

import accountManager from "@/services/accounts";
import publishService, {
  type RelayPublishStatus,
} from "@/services/publish-service";
import { selectRelaysForPublish } from "@/services/relay-selection";
import { settingsManager } from "@/services/settings";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import { refuseKind, type EventDraft } from "@/lib/ai-draft";

/**
 * Sign and publish an event a model drafted.
 *
 * Only ever called from a button on the draft card, never from the tool loop:
 * the model produces text, the user produces a signature. The kind is checked a
 * second time here because this function is the one that signs, and a check that
 * only runs in the tool is a check an edit can route around.
 *
 * Per-relay status is reported as it arrives, so the card can show which relay
 * took it — a publish that half worked is the normal case, not an error.
 */
export async function publishDraft(
  draft: EventDraft,
  options: {
    relays?: string[];
    onStatus?: (
      relay: string,
      status: RelayPublishStatus,
      error?: string,
    ) => void;
  } = {},
): Promise<{ event: NostrEvent; relays: string[] }> {
  const refusal = refuseKind(draft.kind);
  if (refusal) throw new Error(refusal);

  const account = accountManager.active;
  if (!account) throw new Error("No active account");
  const signer = account.signer;
  if (!signer) throw new Error("This account cannot sign.");

  const tags = [...draft.tags];
  if (settingsManager.getSetting("post", "includeClientTag")) {
    tags.push(GRIMOIRE_CLIENT_TAG);
  }

  const event = (await signer.signEvent({
    kind: draft.kind,
    content: draft.content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  })) as NostrEvent;

  const relays =
    options.relays && options.relays.length > 0
      ? options.relays
      : await selectRelaysForPublish(account.pubkey);

  const { updates$, result } = publishService.publishWithUpdates(event, relays);
  const subscription = updates$.subscribe((update) =>
    options.onStatus?.(update.relay, update.status, update.error),
  );

  try {
    const published = await result;
    if (!published.ok) {
      const errors = published.failed
        .map((failure) => `${failure.relay}: ${failure.error}`)
        .join(", ");
      throw new Error(`No relay accepted it. ${errors}`);
    }
  } finally {
    subscription.unsubscribe();
  }

  return { event, relays };
}

/**
 * Relays a draft would go to: the account's write relays, as the post composer
 * picks them. Read before publishing so the card can offer them for unticking.
 */
export async function draftRelays(): Promise<string[]> {
  const pubkey = accountManager.active?.pubkey;
  if (!pubkey) return [];
  try {
    return await selectRelaysForPublish(pubkey);
  } catch {
    return [];
  }
}
