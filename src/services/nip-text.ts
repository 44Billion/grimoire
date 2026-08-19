import db from "./db";

import { getNipUrl } from "@/constants/nips";

/**
 * NIP body from the Dexie cache, fetched from upstream on a miss.
 *
 * `useNip` does the same for the nip window; this is the non-React path, so a
 * consumer that needs the text as data (grounding a prompt, say) does not
 * silently degrade just because the user never opened that NIP.
 */
export async function getNipText(nipId: string): Promise<string | undefined> {
  const cached = await db.nips.get(nipId).catch(() => undefined);
  if (cached?.content) return cached.content;

  try {
    const response = await fetch(getNipUrl(nipId));
    if (!response.ok) return undefined;
    const content = await response.text();
    await db.nips
      .put({ id: nipId, content, fetchedAt: Date.now() })
      .catch(() => undefined);
    return content;
  } catch {
    return undefined;
  }
}
