import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import { getProfileContent } from "applesauce-core/helpers";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  emojiShortcodesToPlainText,
  getEmojiTags,
  type EmojiTag,
} from "@/lib/emoji-helpers";
import eventStore from "./event-store";
import db from "./db";

/**
 * Searchable text for a profile. Names carrying NIP-30 shortcodes are indexed
 * both raw and flattened, so ":H::e::n::k::y:" matches a query for "henky".
 */
function buildSearchText(
  profile: ProfileSearchResult,
  emojis: EmojiTag[],
): string {
  const names = [profile.displayName, profile.username].filter(
    (name): name is string => Boolean(name),
  );
  const flattened = emojis.length
    ? names.map((name) => emojiShortcodesToPlainText(name, emojis))
    : [];

  return [...names, ...flattened, profile.nip05, profile.pubkey]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export interface ProfileSearchResult {
  pubkey: string;
  displayName: string;
  username?: string;
  nip05?: string;
  picture?: string;
  event?: NostrEvent;
}

/**
 * Singleton service for profile search and synchronous profile lookups.
 * Auto-initializes on module load by:
 * 1. Loading profiles from IndexedDB (fast startup)
 * 2. Subscribing to EventStore for new profiles
 */
class ProfileSearchService {
  private index: Index;
  private profiles: Map<string, ProfileSearchResult>;
  private initialized = false;

  constructor() {
    this.profiles = new Map();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Initialize the service by loading from IndexedDB and subscribing to EventStore
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Load from Dexie first (persisted profiles for fast startup)
    try {
      const cachedProfiles = await db.profiles.toArray();
      for (const profile of cachedProfiles) {
        const { pubkey, created_at, ...metadata } = profile;
        const result: ProfileSearchResult = {
          pubkey,
          displayName: getDisplayName(pubkey, metadata),
          username: metadata?.name,
          nip05: metadata?.nip05,
          picture: metadata?.picture,
        };
        this.profiles.set(pubkey, result);
        this.index.add(pubkey, buildSearchText(result, profile.emojis ?? []));
      }
      console.debug(
        `[ProfileSearch] Loaded ${cachedProfiles.length} profiles from IndexedDB`,
      );
    } catch (err) {
      console.warn("[ProfileSearch] Failed to load from IndexedDB:", err);
    }

    // Subscribe to EventStore for new kind 0 events
    eventStore.timeline([{ kinds: [0] }]).subscribe({
      next: (events) => {
        for (const event of events) {
          this.addProfile(event);
        }
      },
      error: (err) => {
        console.warn("[ProfileSearch] EventStore subscription error:", err);
      },
    });
  }

  /**
   * Add a profile to the search index
   */
  async addProfile(event: NostrEvent): Promise<void> {
    if (event.kind !== 0) return;

    const pubkey = event.pubkey;
    const metadata = getProfileContent(event);

    const profile: ProfileSearchResult = {
      pubkey,
      displayName: getDisplayName(pubkey, metadata),
      username: metadata?.name,
      nip05: metadata?.nip05,
      picture: metadata?.picture,
      event,
    };

    this.profiles.set(pubkey, profile);

    await this.index.addAsync(
      pubkey,
      buildSearchText(profile, getEmojiTags(event)),
    );
  }

  /**
   * Add multiple profiles in batch
   */
  async addProfiles(events: NostrEvent[]): Promise<void> {
    for (const event of events) {
      await this.addProfile(event);
    }
  }

  /**
   * Remove a profile from the search index
   */
  async removeProfile(pubkey: string): Promise<void> {
    this.profiles.delete(pubkey);
    await this.index.removeAsync(pubkey);
  }

  /**
   * Search profiles by query string
   */
  async search(
    query: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ProfileSearchResult[]> {
    const { limit = 10, offset = 0 } = options;

    if (!query.trim()) {
      // Return recent profiles when no query
      const items = Array.from(this.profiles.values()).slice(
        offset,
        offset + limit,
      );
      return items;
    }

    // Search index (lowercase for case-insensitive search)
    const ids = (await this.index.searchAsync(query.toLowerCase(), {
      limit: limit + offset,
    })) as string[];

    // Map IDs to profiles
    const items = ids
      .slice(offset, offset + limit)
      .map((id) => this.profiles.get(id))
      .filter(Boolean) as ProfileSearchResult[];

    return items;
  }

  /**
   * Get profile by pubkey (synchronous)
   */
  getByPubkey(pubkey: string): ProfileSearchResult | undefined {
    return this.profiles.get(pubkey);
  }

  /**
   * Get total number of indexed profiles
   */
  get size(): number {
    return this.profiles.size;
  }
}

// Singleton instance
const profileSearch = new ProfileSearchService();

// Auto-initialize on module load
profileSearch.init();

export default profileSearch;
