import { useMemo } from "react";
import { WandSparkles, Play, Star, BookHeart, Bookmark } from "lucide-react";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { useNostrEvent, useNostrEventState } from "@/hooks/useNostrEvent";
import { useFavoriteList, getListPointers } from "@/hooks/useFavoriteList";
import { FAVORITE_LISTS } from "@/config/favorite-lists";
import { SPELL_KIND, SPELLBOOK_KIND } from "@/constants/kinds";
import { useAccount } from "@/hooks/useAccount";
import { useAddWindow } from "@/core/state";
import { decodeSpell } from "@/lib/spell-conversion";
import { parseSpellCommand } from "@/lib/spell-cast";
import type { NostrEvent } from "@/types/nostr";
import type { SpellEvent, SpellbookEvent } from "@/types/spell";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { UserName } from "@/components/nostr/UserName";
import { useGrimoire } from "@/core/state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

/**
 * The "a" tags of a 10777 list, which hold bookmarked spellbooks.
 *
 * Spells are non-addressable and sit in "e" tags, so the two halves of the
 * list never overlap.
 */
function getSpellbookPointers(event: NostrEvent): AddressPointer[] {
  return getListPointers(event, "a").filter((p) => p.kind === SPELLBOOK_KIND);
}

/** Keeps the old title until the list actually holds both kinds */
function listTitle(spellCount: number, spellbookCount: number): string {
  return spellCount > 0 && spellbookCount > 0 ? "Favorites" : "Favorite Spells";
}

/**
 * Kind 10777 Renderer - Favorite Spells (Feed View)
 */
export function FavoriteSpellsRenderer({ event }: BaseEventProps) {
  const pointers = getListPointers(event, "e");
  const spellbooks = getSpellbookPointers(event);

  const parts: string[] = [];
  if (pointers.length > 0)
    parts.push(`${pointers.length} spell${pointers.length !== 1 ? "s" : ""}`);
  if (spellbooks.length > 0)
    parts.push(
      `${spellbooks.length} spellbook${spellbooks.length !== 1 ? "s" : ""}`,
    );

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <WandSparkles className="size-4 text-muted-foreground" />
          <span>{listTitle(pointers.length, spellbooks.length)}</span>
        </ClickableEventTitle>

        <div className="text-xs text-muted-foreground">
          {parts.length === 0 ? "Nothing favorited yet" : parts.join(" · ")}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Individual spell reference item for the detail view
 */
function SpellRefItem({
  pointer,
  onUnfavorite,
  canModify,
}: {
  pointer: EventPointer;
  onUnfavorite?: (event: NostrEvent) => void;
  canModify: boolean;
}) {
  const spellEvent = useNostrEvent(pointer);
  const addWindow = useAddWindow();

  if (!spellEvent) {
    return (
      <div className="flex items-center gap-3 p-3 border border-border/50 rounded">
        <Skeleton className="h-4 w-4 rounded" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48 mt-1" />
        </div>
      </div>
    );
  }

  let decoded: ReturnType<typeof decodeSpell> | null = null;
  try {
    decoded = decodeSpell(spellEvent as SpellEvent);
  } catch {
    // spell couldn't be decoded
  }

  const handleCast = async () => {
    if (!decoded) return;
    const result = await parseSpellCommand(decoded.command);
    if (result) {
      addWindow(result.appId, result.props, result.commandString);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 border border-border/50 rounded group hover:bg-muted/30 transition-colors">
      <WandSparkles className="size-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {decoded?.name || "Unnamed Spell"}
        </div>
        {decoded && (
          <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">
            {decoded.command}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {decoded && (
          <button
            onClick={handleCast}
            className="p-1.5 text-muted-foreground hover:text-accent transition-colors"
            title="Cast spell"
          >
            <Play className="size-3.5" />
          </button>
        )}
        {canModify && onUnfavorite && (
          <button
            onClick={() => onUnfavorite(spellEvent)}
            className="p-1.5 text-muted-foreground hover:text-yellow-500 transition-colors"
            title="Remove from favorites"
          >
            <Star className="size-3.5 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Individual bookmarked spellbook for the detail view
 */
function SpellbookRefItem({
  pointer,
  onUnbookmark,
  canModify,
}: {
  pointer: AddressPointer;
  onUnbookmark?: (coordinate: string) => void;
  canModify: boolean;
}) {
  const { event: spellbookEvent, status } = useNostrEventState(pointer);
  const coordinate = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;
  const { loadSpellbook } = useGrimoire();

  const parsed = useMemo(() => {
    if (!spellbookEvent) return null;
    try {
      return parseSpellbook(spellbookEvent as SpellbookEvent);
    } catch {
      // malformed spellbook content
      return null;
    }
  }, [spellbookEvent]);

  // Only while the load is in flight. A pointer that resolved to nothing falls
  // through to the row below, so the bookmark stays removable.
  if (status === "loading") {
    return (
      <div className="flex items-center gap-3 p-3 border border-border/50 rounded">
        <Skeleton className="h-4 w-4 rounded" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48 mt-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 border border-border/50 rounded group hover:bg-muted/30 transition-colors">
      <BookHeart className="size-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {parsed?.title || pointer.identifier || "Untitled Spellbook"}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
          <UserName pubkey={pointer.pubkey} />
          {!parsed && (
            <span>· {spellbookEvent ? "could not be read" : "not found"}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {parsed && (
          <button
            onClick={() => {
              loadSpellbook(parsed);
              toast.success(`Loaded "${parsed.title}"`);
            }}
            className="p-1.5 text-muted-foreground hover:text-accent transition-colors"
            title="Load spellbook"
          >
            <Play className="size-3.5" />
          </button>
        )}
        {canModify && onUnbookmark && (
          <button
            onClick={() => onUnbookmark(coordinate)}
            className="p-1.5 text-muted-foreground hover:text-yellow-500 transition-colors"
            title="Remove bookmark"
          >
            <Bookmark className="size-3.5 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Kind 10777 Detail Renderer - Favorite Spells (Full View)
 */
export function FavoriteSpellsDetailRenderer({ event }: { event: NostrEvent }) {
  const { canSign } = useAccount();
  const { toggleFavorite } = useFavoriteList(FAVORITE_LISTS[SPELL_KIND]);
  const { removeItem: removeBookmark } = useFavoriteList(
    FAVORITE_LISTS[SPELLBOOK_KIND],
  );

  const pointers = getListPointers(event, "e");
  const spellbookPointers = getSpellbookPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <WandSparkles className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">
          {listTitle(pointers.length, spellbookPointers.length)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
          Spells ({pointers.length})
        </div>
        {pointers.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No favorite spells yet. Star a spell to add it here.
          </div>
        ) : (
          pointers.map((pointer) => (
            <SpellRefItem
              key={pointer.id}
              pointer={pointer}
              onUnfavorite={canSign ? toggleFavorite : undefined}
              canModify={canSign}
            />
          ))
        )}
      </div>

      {spellbookPointers.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
            Spellbooks ({spellbookPointers.length})
          </div>
          {spellbookPointers.map((pointer) => (
            <SpellbookRefItem
              key={`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`}
              pointer={pointer}
              onUnbookmark={canSign ? removeBookmark : undefined}
              canModify={canSign}
            />
          ))}
        </div>
      )}
    </div>
  );
}
