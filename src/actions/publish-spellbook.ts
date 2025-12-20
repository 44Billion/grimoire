import accountManager from "@/services/accounts";
import pool from "@/services/relay-pool";
import { createSpellbook } from "@/lib/spellbook-manager";
import { markSpellbookPublished } from "@/services/spellbook-storage";
import { EventFactory } from "applesauce-factory";
import { SpellbookEvent } from "@/types/spell";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { mergeRelaySets } from "applesauce-core/helpers";
import { GrimoireState } from "@/types/app";

export interface PublishSpellbookOptions {
  state: GrimoireState;
  title: string;
  description?: string;
  workspaceIds?: string[];
  localId?: string; // If provided, updates this local spellbook
}

export class PublishSpellbookAction {
  type = "publish-spellbook";
  label = "Publish Spellbook";

  async execute(options: PublishSpellbookOptions): Promise<void> {
    const { state, title, description, workspaceIds, localId } = options;
    const account = accountManager.active;

    if (!account) throw new Error("No active account");
    const signer = account.signer;
    if (!signer) throw new Error("No signer available");

    // 1. Create event props from state
    const encoded = createSpellbook({
      state,
      title,
      description,
      workspaceIds,
    });

    // 2. Build and sign event
    const factory = new EventFactory({ signer });
    const draft = await factory.build({
      kind: encoded.eventProps.kind,
      content: encoded.eventProps.content,
      tags: encoded.eventProps.tags,
    });

    const event = (await factory.sign(draft)) as SpellbookEvent;

    // 3. Determine relays
    let relays: string[] = [];
    const authorWriteRelays = (await relayListCache.getOutboxRelays(account.pubkey)) || [];
    relays = mergeRelaySets(authorWriteRelays, AGGREGATOR_RELAYS);

    // 4. Publish
    await pool.publish(relays, event);

    // 5. Mark as published in local DB
    if (localId) {
      await markSpellbookPublished(localId, event);
    }
  }
}
