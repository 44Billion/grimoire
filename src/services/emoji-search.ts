import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { UNICODE_EMOJIS, EMOJI_KEYWORDS } from "@/lib/unicode-emojis";
import { emojiSetCache } from "./emoji-set-cache";
import { getRecentEmojiKeys } from "./emoji-usage";
import { addressLoader } from "./loaders";
import { fetchRelayList } from "./relay-selection";

/** How long to wait for a set author's relay list before asking without it. */
const RELAY_LIST_TIMEOUT_MS = 5_000;

export interface EmojiSearchResult {
  shortcode: string;
  url: string;
  /** Source of the emoji: "unicode", "user", "set:<identifier>", or "context" */
  source: string;
  /** NIP-30 optional 4th tag: "30030:pubkey:identifier" address of the emoji set */
  address?: string;
}

export class EmojiSearchService {
  private index: Index;
  private emojis: Map<string, EmojiSearchResult>;

  // Subscription management: one relay-backed sub (kind 10030) and one
  // *store* sub per referenced set — those open no socket; they are how a
  // set that arrives late, from anywhere, still reaches the index.
  private userListSub: Subscription | null = null;
  private setSubs = new Map<string, Subscription>();
  private currentPubkey: string | null = null;
  private eventStore: IEventStore | null = null;

  constructor() {
    this.emojis = new Map();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Add a single emoji to the search index
   */
  async addEmoji(
    shortcode: string,
    url: string,
    source: string = "custom",
    address?: string,
  ): Promise<void> {
    // Normalize shortcode (lowercase, no colons)
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");

    // Don't overwrite user emoji with other sources
    const existing = this.emojis.get(normalized);
    if (existing && existing.source === "user" && source !== "user") {
      return;
    }

    const emoji: EmojiSearchResult = {
      shortcode: normalized,
      url,
      source,
      address,
    };

    this.emojis.set(normalized, emoji);
    await this.index.addAsync(normalized, normalized);
  }

  /**
   * Add emojis from an emoji set event (kind 30030)
   */
  async addEmojiSet(event: NostrEvent): Promise<void> {
    if (event.kind !== 30030) return;

    const identifier =
      event.tags.find((t) => t[0] === "d")?.[1] || "unnamed-set";
    const address = `30030:${event.pubkey}:${identifier}`;
    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(
        emoji.shortcode,
        emoji.url,
        `set:${identifier}`,
        address,
      );
    }
  }

  /**
   * Add emojis from user's emoji list (kind 10030)
   */
  async addUserEmojiList(event: NostrEvent): Promise<void> {
    if (event.kind !== 10030) return;

    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(emoji.shortcode, emoji.url, "user");
    }
  }

  /**
   * Add context emojis from an event being replied to
   */
  async addContextEmojis(event: NostrEvent): Promise<void> {
    const emojis = getEmojiTags(event);

    for (const emoji of emojis) {
      await this.addEmoji(emoji.shortcode, emoji.url, "context");
    }
  }

  /**
   * Add multiple Unicode emojis with keyword-enriched search indexing.
   * Keywords from emojilib are joined into the indexed string so that
   * searching "happy" finds 😀, "animal" finds 🐶, etc.
   */
  addUnicodeEmojis(
    emojis: Array<{ shortcode: string; emoji: string }>,
    keywords?: Record<string, string[]>,
  ): void {
    for (const { shortcode, emoji } of emojis) {
      const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");

      const emojiResult: EmojiSearchResult = {
        shortcode: normalized,
        url: emoji,
        source: "unicode",
      };

      this.emojis.set(normalized, emojiResult);

      // Build search string: shortcode + emojilib keywords for richer matching
      const emojiKeywords = keywords?.[emoji];
      const searchText = emojiKeywords
        ? `${normalized} ${emojiKeywords.join(" ")}`
        : normalized;

      this.index.add(normalized, searchText);
    }
  }

  /**
   * Load cached emojis from Dexie for immediate availability.
   * Called before relay subscriptions so emojis are usable instantly.
   */
  async loadCachedForUser(pubkey: string): Promise<void> {
    // Load cached user emoji list (kind 10030)
    const cachedList = await emojiSetCache.getUserEmojiList(pubkey);
    if (cachedList) {
      // Add inline emojis from the user's list
      for (const emoji of cachedList.emojis) {
        await this.addEmoji(emoji.shortcode, emoji.url, "user");
      }

      // Load all referenced emoji sets in bulk
      if (cachedList.setAddresses.length > 0) {
        const cachedSets = await emojiSetCache.getEmojiSetsForAddresses(
          cachedList.setAddresses,
        );
        for (const cachedSet of cachedSets) {
          const identifier = cachedSet.address.split(":")[2] || "unnamed-set";
          for (const emoji of cachedSet.emojis) {
            await this.addEmoji(
              emoji.shortcode,
              emoji.url,
              `set:${identifier}`,
              cachedSet.address,
            );
          }
        }
      }
    }

    console.debug(
      `[EmojiSearch] Loaded ${this.emojis.size} emojis from cache for ${pubkey.slice(0, 8)}`,
    );
  }

  /**
   * Subscribe to EventStore for live emoji updates.
   * One relay-backed subscription (the kind 10030 list); every set it names
   * gets a store subscription and one outbox-aware fetch.
   */
  subscribeForUser(pubkey: string, eventStore: IEventStore): void {
    if (this.currentPubkey === pubkey) return;

    // Clean up any existing subscriptions
    this.unsubscribeUser();
    this.currentPubkey = pubkey;
    this.eventStore = eventStore;

    // Subscribe to user's emoji list (kind 10030) — the only open subscription
    const userEmojiList$ = eventStore.replaceable(10030, pubkey);
    this.userListSub = userEmojiList$.subscribe({
      next: (event) => {
        if (!event) return;

        this.addUserEmojiList(event);
        emojiSetCache.setUserEmojiList(event);

        // The sets the list names, with the relay hint NIP-51 lets an `a`
        // tag carry — half of a real list has one, and it is the one relay
        // known to hold that set.
        const named = new Map<string, string | undefined>();
        for (const t of event.tags) {
          if (t[0] === "a" && t[1]?.startsWith("30030:")) {
            named.set(t[1], t[2] || undefined);
          }
        }

        // Watch the sets newly named; stop watching the ones dropped.
        for (const [address, hint] of named) {
          if (!this.setSubs.has(address)) this.watchEmojiSet(address, hint);
        }
        for (const [address, sub] of this.setSubs) {
          if (!named.has(address)) {
            sub.unsubscribe();
            this.setSubs.delete(address);
          }
        }
      },
      error: (error) => {
        console.error("[EmojiSearch] Failed to load user emoji list:", error);
      },
    });
  }

  /**
   * Index an emoji set whenever the store has it, and ask for it once.
   *
   * This used to be a single `firstValueFrom` on the store with a 15s
   * timeout, resolved through the store's own loader. Three things made that
   * miss on a real list and then never recover: the store loader asks the
   * indexers and the content fallback, and an emoji set lives on its
   * author's relays — measured on a live list, zero of eight sets on the
   * indexers; the `a` tag's relay hint was never read; and after the
   * timeout the address stayed "tracked", so an explicit `req` that landed
   * the set a minute later was indexed by nothing.
   *
   * So: the store subscription stays open — it costs no socket, and a set
   * arriving from any later request is indexed the moment it lands — and the
   * fetch goes through `addressLoader`, which follows the hint and the
   * author's outbox. Where neither is known yet, the author's relay list is
   * resolved first, bounded, so the outbox step has something to use.
   */
  private watchEmojiSet(address: string, hint?: string): void {
    if (!this.eventStore) return;

    const parts = address.split(":");
    if (parts.length < 3) return;
    const kind = parseInt(parts[0], 10);
    const setPubkey = parts[1];
    const identifier = parts.slice(2).join(":");
    if (!kind || !setPubkey) return;

    const sub = this.eventStore
      .replaceable(kind, setPubkey, identifier)
      .subscribe((setEvent) => {
        if (!setEvent) return;
        this.addEmojiSet(setEvent);
        emojiSetCache.setEmojiSet(setEvent);
      });
    this.setSubs.set(address, sub);

    void this.fetchEmojiSet(kind, setPubkey, identifier, hint);
  }

  private async fetchEmojiSet(
    kind: number,
    setPubkey: string,
    identifier: string,
    hint?: string,
  ): Promise<void> {
    // Without a hint the outbox is the only route, and `addressLoader`'s
    // outbox step is a synchronous lookup — so make sure there is a list
    // to look up before asking.
    if (!hint && setPubkey !== this.currentPubkey) {
      await fetchRelayList(setPubkey, RELAY_LIST_TIMEOUT_MS);
    }

    // The event lands in the store; the subscription above indexes it.
    addressLoader({
      kind,
      pubkey: setPubkey,
      identifier,
      relays: hint ? [hint] : undefined,
    }).subscribe({
      error: () => {
        // A relay that refused or timed out. The store subscription stays,
        // so the set is still indexed the moment anything else lands it.
      },
    });
  }

  /**
   * Tear down relay subscription and clear custom emojis
   */
  unsubscribeUser(): void {
    if (this.userListSub) {
      this.userListSub.unsubscribe();
      this.userListSub = null;
    }

    for (const sub of this.setSubs.values()) sub.unsubscribe();
    this.setSubs.clear();
    this.currentPubkey = null;
    this.eventStore = null;

    this.clearCustom();
  }

  /**
   * Search emojis by shortcode
   */
  async search(
    query: string,
    options: { limit?: number } = {},
  ): Promise<EmojiSearchResult[]> {
    const { limit = 24 } = options;

    // Normalize query
    const normalizedQuery = query.toLowerCase().replace(/^:|:$/g, "");

    if (!normalizedQuery.trim()) {
      // Show recently-used emojis first, then fill with source-priority order
      const recentKeys = getRecentEmojiKeys(limit);
      const results: EmojiSearchResult[] = [];
      const included = new Set<string>();

      // Resolve recent keys to indexed emojis
      for (const key of recentKeys) {
        let result: EmojiSearchResult | undefined;
        if (key.startsWith(":") && key.endsWith(":")) {
          result = this.emojis.get(key.slice(1, -1));
        } else {
          // Unicode: key is the emoji character, stored as `url`
          for (const emoji of this.emojis.values()) {
            if (emoji.source === "unicode" && emoji.url === key) {
              result = emoji;
              break;
            }
          }
        }
        if (result) {
          results.push(result);
          included.add(result.shortcode);
        }
      }

      // Fill remaining slots with source-priority sorted emojis
      if (results.length < limit) {
        const sourcePriority: Record<string, number> = {
          user: 0,
          context: 1,
          unicode: 3,
        };
        const remaining = Array.from(this.emojis.values())
          .filter((e) => !included.has(e.shortcode))
          .sort((a, b) => {
            const aPriority = a.source.startsWith("set:")
              ? 2
              : (sourcePriority[a.source] ?? 2);
            const bPriority = b.source.startsWith("set:")
              ? 2
              : (sourcePriority[b.source] ?? 2);
            return aPriority - bPriority;
          })
          .slice(0, limit - results.length);
        results.push(...remaining);
      }

      return results;
    }

    // Search index
    const ids = (await this.index.searchAsync(normalizedQuery, {
      limit,
    })) as string[];

    // Map IDs to emojis
    const items = ids
      .map((id) => this.emojis.get(id))
      .filter(Boolean) as EmojiSearchResult[];

    return items;
  }

  /**
   * Get emoji by shortcode
   */
  getByShortcode(shortcode: string): EmojiSearchResult | undefined {
    const normalized = shortcode.toLowerCase().replace(/^:|:$/g, "");
    return this.emojis.get(normalized);
  }

  /**
   * Clear all emojis
   */
  clear(): void {
    this.emojis.clear();
    this.index = new Index({
      tokenize: "forward",
      cache: true,
      resolution: 9,
    });
  }

  /**
   * Clear only custom emojis (keep unicode).
   * Re-indexes unicode emojis synchronously with keyword-enriched search.
   */
  clearCustom(): void {
    this.clear();
    this.addUnicodeEmojis(UNICODE_EMOJIS, EMOJI_KEYWORDS);
  }

  /**
   * Get total number of indexed emojis
   */
  get size(): number {
    return this.emojis.size;
  }
}

// Singleton instance with Unicode emojis pre-loaded (with keyword-enriched search)
const emojiSearchService = new EmojiSearchService();
emojiSearchService.addUnicodeEmojis(UNICODE_EMOJIS, EMOJI_KEYWORDS);

export default emojiSearchService;
