import type { NostrEvent } from "nostr-tools";

import accountManager from "@/services/accounts";
import publishService from "@/services/publish-service";
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
 */
export async function publishDraft(
  draft: EventDraft,
  targetRelays?: string[],
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
    targetRelays && targetRelays.length > 0
      ? targetRelays
      : await selectRelaysForPublish(account.pubkey);

  const result = await publishService.publish(event, relays);
  if (!result.ok) {
    const errors = result.failed
      .map((failure) => `${failure.relay}: ${failure.error}`)
      .join(", ");
    throw new Error(`No relay accepted it. ${errors}`);
  }

  return { event, relays };
}
