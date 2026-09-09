import { useCallback, useMemo, useState } from "react";
import {
  BookHeart,
  Bookmark,
  Check,
  ChevronDown,
  Cloud,
  GitFork,
  Lock,
  Plus,
  Save,
  Settings,
  Share2,
  User,
  Users,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation, useNavigate } from "react-router";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { parseSpellbook } from "@/lib/spellbook-manager";
import type { SpellbookEvent, ParsedSpellbook } from "@/types/spell";
import { SPELLBOOK_KIND } from "@/constants/kinds";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SaveSpellbookDialog } from "./SaveSpellbookDialog";
import { toast } from "sonner";
import { UserName } from "./nostr/UserName";
import { useAccount } from "@/hooks/useAccount";
import { useFavoriteList } from "@/hooks/useFavoriteList";
import { FAVORITE_LISTS } from "@/config/favorite-lists";
import { useNostrEventState } from "@/hooks/useNostrEvent";
import { Skeleton } from "./ui/skeleton";
import type { AddressPointer } from "nostr-tools/nip19";

/**
 * Status indicator component for spellbook state
 */
function SpellbookStatus({
  owner,
  isOwner,
  isPublished,
  isLocal,
  className,
}: {
  owner?: string;
  isOwner: boolean;
  isPublished?: boolean;
  isLocal?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 text-[10px] text-muted-foreground",
        className,
      )}
    >
      {/* Ownership */}
      {isOwner ? (
        <span className="flex items-center gap-0.5" title="Your spellbook">
          <User className="size-2.5" />
          <span>you</span>
        </span>
      ) : owner ? (
        <span className="flex items-center gap-0.5" title="Others' spellbook">
          <Users className="size-2.5" />
          <UserName pubkey={owner} />
        </span>
      ) : null}
      <span className="opacity-50">•</span>
      {/* Storage status */}
      {isPublished ? (
        <span
          className="flex items-center gap-0.5 text-green-600"
          title="Published to Nostr"
        >
          <Cloud className="size-2.5" />
          <span>published</span>
        </span>
      ) : isLocal ? (
        <span className="flex items-center gap-0.5" title="Local only">
          <Lock className="size-2.5" />
          <span>local</span>
        </span>
      ) : (
        <span
          className="flex items-center gap-0.5"
          title="Network only (not in library)"
        >
          <Cloud className="size-2.5" />
          <span>network</span>
        </span>
      )}
    </div>
  );
}

/**
 * One bookmarked spellbook, resolved from its "a" tag coordinate.
 *
 * Bookmarks point at other people's books, so they cannot come from the
 * author-scoped timeline above — each row loads its own address pointer
 * through the address loader, which routes by the author's outbox.
 */
function BookmarkedSpellbookItem({
  pointer,
  selfPubkey,
  isActive,
  onLoad,
  onRemove,
  className,
}: {
  pointer: AddressPointer;
  selfPubkey?: string;
  isActive: (pubkey: string, slug: string) => boolean;
  onLoad: (spellbook: ParsedSpellbook) => void;
  onRemove?: (coordinate: string) => void;
  className?: string;
}) {
  const { event, status } = useNostrEventState(pointer);
  const coordinate = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;

  const parsed = useMemo(() => {
    if (!event) return null;
    try {
      return {
        ...parseSpellbook(event as SpellbookEvent),
        isPublished: true,
        source: "network" as const,
      };
    } catch {
      // A malformed book stays out of the list rather than crashing it
      return null;
    }
  }, [event]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Bookmark className="size-3.5 flex-shrink-0 text-muted-foreground" />
        <Skeleton className="h-4 flex-1" />
      </div>
    );
  }

  // An entry that cannot be read still has to be removable: without a row of
  // its own, a book that was deleted — or whose author's relays are all
  // unreachable — would sit in the list with no way to take it out.
  if (!event || !parsed) {
    return (
      <div className="flex items-start gap-2 px-3 py-2">
        <Bookmark className="size-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm text-muted-foreground italic">
            {pointer.identifier || "Untitled Spellbook"}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <UserName pubkey={pointer.pubkey} />
            <span className="opacity-50">•</span>
            <span>{event ? "unreadable" : "not found"}</span>
          </div>
        </div>
        {onRemove && (
          <button
            onClick={() => onRemove(coordinate)}
            className="p-0.5 text-yellow-500 hover:text-muted-foreground transition-colors flex-shrink-0"
            title="Remove bookmark"
          >
            <Bookmark className="size-3.5 fill-current" />
          </button>
        )}
      </div>
    );
  }

  const active = isActive(event.pubkey, parsed.slug);

  return (
    <DropdownMenuItem
      disabled={active}
      onClick={() => onLoad(parsed)}
      className={cn(className, "flex items-start gap-2", active && "bg-muted")}
    >
      <Bookmark
        className={cn(
          "size-3.5 flex-shrink-0 mt-0.5 text-muted-foreground",
          active && "text-foreground",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className={cn("truncate text-sm", active && "font-medium")}>
          {parsed.title}
        </div>
        <SpellbookStatus
          owner={event.pubkey}
          isOwner={event.pubkey === selfPubkey}
          isPublished
        />
      </div>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(coordinate);
          }}
          className="p-0.5 text-yellow-500 hover:text-muted-foreground transition-colors flex-shrink-0"
          title="Remove bookmark"
        >
          <Bookmark className="size-3.5 fill-current" />
        </button>
      )}
    </DropdownMenuItem>
  );
}

export function SpellbookDropdown() {
  const {
    state,
    loadSpellbook,
    addWindow,
    clearActiveSpellbook,
    applyTemporaryToPersistent,
    discardTemporary,
    isTemporary,
  } = useGrimoire();
  const location = useLocation();
  const navigate = useNavigate();
  const { canSign } = useAccount();
  const activeAccount = state.activeAccount;
  const activeSpellbook = state.activeSpellbook;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [dialogSpellbook, setDialogSpellbook] = useState<
    | {
        slug: string;
        title: string;
        description?: string;
        workspaceIds?: string[];
        localId?: string;
        pubkey?: string;
      }
    | undefined
  >(undefined);

  // Check if we're in preview mode
  const isPreviewMode = location.pathname.startsWith("/preview/");

  // 1. Load Local Data
  const localSpellbooks = useLiveQuery(() =>
    db.spellbooks.toArray().then((books) => books.filter((b) => !b.deletedAt)),
  );

  // 2. Fetch Network Data
  const { events: networkEvents } = useReqTimeline(
    activeAccount ? `header-spellbooks-${activeAccount.pubkey}` : "none",
    activeAccount
      ? { kinds: [SPELLBOOK_KIND], authors: [activeAccount.pubkey] }
      : [],
    activeAccount?.relays?.map((r) => r.url) || [],
    { stream: true },
  );

  // 2b. Bookmarked spellbooks (kind 10777 "a" tags — other people's books)
  const { items: bookmarkPointers, removeItem: removeBookmark } =
    useFavoriteList(FAVORITE_LISTS[SPELLBOOK_KIND]);

  // useFavoriteList types items as the e/a union; the spellbook config is an
  // "a" list, so narrow to the coordinates that name a spellbook.
  const bookmarks = useMemo(
    () =>
      bookmarkPointers.filter(
        (p): p is AddressPointer =>
          "identifier" in p && p.kind === SPELLBOOK_KIND && !!p.pubkey,
      ),
    [bookmarkPointers],
  );

  // 3. Process Spellbooks
  const spellbooks = useMemo(() => {
    if (!activeAccount) return [];
    const allMap = new Map<string, ParsedSpellbook>();

    for (const s of localSpellbooks || []) {
      allMap.set(s.slug, {
        slug: s.slug,
        title: s.title,
        description: s.description,
        content: s.content,
        referencedSpells: [],
        event: s.event as SpellbookEvent,
        localId: s.id,
        isPublished: s.isPublished,
        source: "local",
      });
    }

    for (const event of networkEvents) {
      const slug = event.tags.find((t) => t[0] === "d")?.[1] || "";
      if (!slug) continue;
      const existing = allMap.get(slug);
      if (
        existing &&
        event.created_at * 1000 <= (existing.event?.created_at || 0) * 1000
      )
        continue;
      try {
        const parsed = parseSpellbook(event as SpellbookEvent);
        allMap.set(slug, {
          ...parsed,
          localId: existing?.localId,
          isPublished: true,
          source: existing?.localId ? "local" : "network",
        });
      } catch (_e) {
        // ignore
      }
    }

    return Array.from(allMap.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [localSpellbooks, networkEvents, activeAccount]);

  /**
   * A slug alone is not an identity: two authors can publish the same "d" tag,
   * and bookmarks bring foreign books into this menu. Compare author + slug,
   * treating a missing pubkey (an unpublished local book) as the active account.
   */
  const isActiveSpellbook = useCallback(
    (pubkey: string | undefined, slug: string) => {
      if (!activeSpellbook || activeSpellbook.slug !== slug) return false;
      return (
        (activeSpellbook.pubkey ?? activeAccount?.pubkey) ===
        (pubkey ?? activeAccount?.pubkey)
      );
    },
    [activeSpellbook, activeAccount],
  );

  const owner = activeSpellbook?.pubkey;
  // Derived states for clearer UX
  const isOwner = useMemo(() => {
    if (!activeSpellbook) return false;
    // Owner if: no pubkey (local-only) OR pubkey matches active account
    return (
      !activeSpellbook.pubkey ||
      activeSpellbook.pubkey === activeAccount?.pubkey
    );
  }, [activeSpellbook, activeAccount]);

  const isInLibrary = useMemo(() => {
    if (!activeSpellbook) return false;
    return !!activeSpellbook.localId;
  }, [activeSpellbook]);

  // Show dropdown if: in preview mode, has active account, or has active spellbook
  if (!isPreviewMode && !activeAccount && !activeSpellbook) {
    return null;
  }

  const handleLoadSpellbook = (sb: ParsedSpellbook) => {
    loadSpellbook(sb);
    toast.success(`Loaded "${sb.title}"`);
  };

  const handleUpdateSpellbook = async () => {
    if (!activeSpellbook) return;

    const local = await db.spellbooks
      .where("slug")
      .equals(activeSpellbook.slug)
      .first();

    setDialogSpellbook({
      slug: activeSpellbook.slug,
      title: activeSpellbook.title,
      description: local?.description || activeSpellbook.description,
      workspaceIds: Object.keys(state.workspaces),
      localId: local?.id || activeSpellbook.localId,
      pubkey: activeSpellbook.pubkey,
    });
    setSaveDialogOpen(true);
  };

  const handleForkSpellbook = () => {
    if (!activeSpellbook) return;
    // Open save dialog without existing spellbook to create a new one
    setDialogSpellbook(undefined);
    setSaveDialogOpen(true);
  };

  const handleNewSpellbook = () => {
    setDialogSpellbook(undefined);
    setSaveDialogOpen(true);
  };

  const handleApplyToMain = () => {
    applyTemporaryToPersistent();
    navigate("/", { replace: true });
    toast.success("Spellbook applied to your dashboard");
  };

  const handleExitPreview = () => {
    discardTemporary();
    navigate("/", { replace: true });
  };

  const handleCloseSpellbook = () => {
    if (isTemporary) {
      discardTemporary();
      navigate("/", { replace: true });
      toast.info("Returned to your dashboard");
    } else {
      clearActiveSpellbook();
      toast.info("Spellbook closed");
    }
  };

  const itemClass =
    "cursor-pointer py-2 hover:bg-muted focus:bg-muted transition-colors";

  return (
    <>
      <SaveSpellbookDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        existingSpellbook={isOwner && isInLibrary ? dialogSpellbook : undefined}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 md:h-7 px-2 gap-1.5 cursor-crosshair text-muted-foreground hover:text-foreground",
              activeSpellbook && "text-foreground font-medium",
              isTemporary && "ring-1 ring-amber-500/50",
            )}
          >
            <BookHeart
              className={cn("size-4", isTemporary && "text-amber-500")}
            />
            <span className="text-xs font-medium max-w-[100px] sm:max-w-[120px] truncate">
              {activeSpellbook ? activeSpellbook.title : "grimoire"}
            </span>
            <ChevronDown className="size-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          className="w-72 max-h-[80vh] overflow-y-auto"
        >
          {/* Preview Mode Banner */}
          {isPreviewMode && (
            <>
              <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-600 text-xs font-medium">
                  <BookHeart className="size-3.5" />
                  Preview Mode
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  You're viewing a shared spellbook. Apply to keep it.
                </p>
              </div>
              {activeSpellbook && (
                <div className="px-3 py-2 border-b">
                  <div className="font-medium text-sm truncate">
                    {activeSpellbook.title}
                  </div>
                  <SpellbookStatus
                    owner={owner}
                    isOwner={isOwner}
                    isPublished={activeSpellbook.isPublished}
                    isLocal={isInLibrary}
                    className="mt-1"
                  />
                </div>
              )}
              <DropdownMenuItem
                onClick={handleApplyToMain}
                className={cn(
                  itemClass,
                  "bg-green-500/5 text-green-600 font-medium",
                )}
              >
                <Check className="size-3.5 mr-2" />
                Apply to Dashboard
              </DropdownMenuItem>
              {activeAccount && (
                <DropdownMenuItem
                  onClick={handleForkSpellbook}
                  className={itemClass}
                >
                  <GitFork className="size-3.5 mr-2 text-muted-foreground" />
                  Fork to Library
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={handleExitPreview}
                className={cn(itemClass, "text-muted-foreground")}
              >
                <X className="size-3.5 mr-2" />
                Exit Preview
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Active Spellbook Section (non-preview) */}
          {activeSpellbook && !isPreviewMode && (
            <>
              <DropdownMenuLabel className="py-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                Active Spellbook
              </DropdownMenuLabel>
              <div className="px-3 py-2 border-b">
                <div className="font-medium text-sm truncate">
                  {activeSpellbook.title}
                </div>
                <SpellbookStatus
                  owner={activeSpellbook.pubkey}
                  isOwner={isOwner}
                  isPublished={activeSpellbook.isPublished}
                  isLocal={isInLibrary}
                  className="mt-1"
                />
              </div>

              {/* Temporary session actions */}
              {isTemporary && (
                <DropdownMenuItem
                  onClick={handleApplyToMain}
                  className={cn(itemClass, "bg-amber-500/5 font-medium")}
                >
                  <Check className="size-3.5 mr-2 text-amber-600" />
                  Keep This Spellbook
                </DropdownMenuItem>
              )}

              {/* Owner actions */}
              {isOwner && isInLibrary && (
                <DropdownMenuItem
                  onClick={handleUpdateSpellbook}
                  className={itemClass}
                >
                  <Save className="size-3.5 mr-2 text-muted-foreground" />
                  Update & Publish
                </DropdownMenuItem>
              )}

              {/* Non-owner or not in library actions */}
              {(!isOwner || !isInLibrary) && activeAccount && (
                <DropdownMenuItem
                  onClick={handleForkSpellbook}
                  className={itemClass}
                >
                  <GitFork className="size-3.5 mr-2 text-muted-foreground" />
                  {isOwner ? "Save to Library" : "Fork to Library"}
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={() => addWindow("spellbooks", {})}
                className={cn(itemClass, "text-muted-foreground text-xs")}
              >
                <Share2 className="size-3.5 mr-2" />
                Share...
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={handleCloseSpellbook}
                className={cn(itemClass, "text-muted-foreground text-xs")}
              >
                <X className="size-3.5 mr-2" />
                Close Spellbook
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* My Spellbooks Section */}
          {activeAccount && (
            <>
              <DropdownMenuLabel className="flex items-center justify-between py-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                My Spellbooks
              </DropdownMenuLabel>

              {spellbooks.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground italic">
                  No spellbooks saved yet.
                </div>
              ) : (
                spellbooks.map((sb) => {
                  const isActive = isActiveSpellbook(sb.event?.pubkey, sb.slug);
                  return (
                    <DropdownMenuItem
                      key={sb.slug}
                      disabled={isActive}
                      onClick={() => handleLoadSpellbook(sb)}
                      className={cn(
                        itemClass,
                        "flex items-center gap-2",
                        isActive && "bg-muted",
                      )}
                    >
                      <BookHeart
                        className={cn(
                          "size-3.5 flex-shrink-0 text-muted-foreground",
                          isActive && "text-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate flex-1 text-sm",
                          isActive && "font-medium",
                        )}
                      >
                        {sb.title}
                      </span>
                      {/* Status badge */}
                      {sb.isPublished ? (
                        <Cloud
                          className="size-3 text-green-600 flex-shrink-0"
                          aria-label="Published"
                        />
                      ) : (
                        <Lock
                          className="size-3 text-muted-foreground flex-shrink-0"
                          aria-label="Local only"
                        />
                      )}
                    </DropdownMenuItem>
                  );
                })
              )}

              {/* Bookmarked Spellbooks (others' books, from the 10777 list) */}
              {bookmarks.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="flex items-center justify-between py-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Bookmarked
                  </DropdownMenuLabel>
                  {bookmarks.map((pointer) => (
                    <BookmarkedSpellbookItem
                      key={`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`}
                      pointer={pointer}
                      selfPubkey={activeAccount.pubkey}
                      isActive={isActiveSpellbook}
                      onLoad={handleLoadSpellbook}
                      onRemove={canSign ? removeBookmark : undefined}
                      className={itemClass}
                    />
                  ))}
                </>
              )}

              <DropdownMenuSeparator />

              {/* Actions */}
              <DropdownMenuItem
                onClick={handleNewSpellbook}
                className={itemClass}
              >
                <Plus className="size-3.5 mr-2 text-muted-foreground" />
                <span className="text-sm">Save Current as Spellbook</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => addWindow("spellbooks", {})}
                className={cn(itemClass, "text-muted-foreground")}
              >
                <Settings className="size-3.5 mr-2" />
                <span className="text-sm">Manage Library</span>
              </DropdownMenuItem>
            </>
          )}

          {/* Non-logged-in user in preview mode */}
          {!activeAccount && isPreviewMode && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground italic">
              Log in to save and manage spellbooks
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
