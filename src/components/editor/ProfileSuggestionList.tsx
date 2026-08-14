import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ProfileSearchResult } from "@/services/profile-search";
import { UserName } from "../nostr/UserName";

export interface ProfileSuggestionListProps {
  items: ProfileSearchResult[];
  command: (item: ProfileSearchResult) => void;
  onClose?: () => void;
}

export interface ProfileSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Row height estimate for the first paint only — rows grow with their content
 * (a name spelled in custom emoji is taller), so the real height comes from
 * Virtuoso and is capped at MAX_LIST_HEIGHT. */
const ITEM_HEIGHT = 48;
const MAX_LIST_HEIGHT = ITEM_HEIGHT * 6;

export const ProfileSuggestionList = forwardRef<
  ProfileSuggestionListHandle,
  ProfileSuggestionListProps
>(({ items, command, onClose }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [listHeight, setListHeight] = useState(() =>
    Math.min(items.length * ITEM_HEIGHT, MAX_LIST_HEIGHT),
  );
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Keyboard navigation
  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }

      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
        if (items[selectedIndex]) {
          command(items[selectedIndex]);
        }
        return true;
      }

      if (event.key === "Escape") {
        onClose?.();
        return true;
      }

      return false;
    },
  }));

  // Scroll selected item into view via Virtuoso
  useEffect(() => {
    virtuosoRef.current?.scrollIntoView({
      index: selectedIndex,
      behavior: "auto",
    });
  }, [selectedIndex]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const renderItem = useCallback(
    (index: number) => {
      const item = items[index];
      return (
        <button
          role="option"
          aria-selected={index === selectedIndex}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            command(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`flex w-full items-center gap-3 px-3 py-2.5 min-h-[44px] text-left transition-colors ${
            index === selectedIndex ? "bg-muted/60" : "hover:bg-muted/60"
          }`}
        >
          {item.picture ? (
            <img
              src={item.picture}
              alt=""
              className="size-8 rounded-full object-cover flex-shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="size-8 rounded-full bg-muted flex-shrink-0 flex items-center justify-center text-xs text-muted-foreground">
              {item.displayName?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              <UserName pubkey={item.pubkey} />
            </div>
            {item.nip05 && (
              <div className="truncate text-xs text-muted-foreground">
                {item.nip05}
              </div>
            )}
          </div>
        </button>
      );
    },
    [items, selectedIndex, command],
  );

  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      className="w-[320px] max-w-full rounded-md border border-border/50 bg-popover text-popover-foreground shadow-md overflow-hidden"
    >
      <Virtuoso
        ref={virtuosoRef}
        totalCount={items.length}
        defaultItemHeight={ITEM_HEIGHT}
        totalListHeightChanged={(height) =>
          setListHeight(Math.min(height, MAX_LIST_HEIGHT))
        }
        style={{ height: listHeight }}
        className="overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-track]:bg-transparent"
        itemContent={renderItem}
      />
    </div>
  );
});

ProfileSuggestionList.displayName = "ProfileSuggestionList";
