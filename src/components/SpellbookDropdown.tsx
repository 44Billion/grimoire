import { useMemo } from "react";
import { BookHeart, ChevronDown, Layout, Loader2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function SpellbookDropdown() {
  const { state, loadSpellbook, addWindow } = useGrimoire();
  const activeAccount = state.activeAccount;

  // Load local spellbooks from Dexie
  const localSpellbooks = useLiveQuery(() =>
    db.spellbooks.toArray().then(books => books.filter(b => !b.deletedAt)),
  );

  // Fetch from Nostr
  const { events: networkEvents, loading: networkLoading } = useReqTimeline(
    activeAccount ? `header-spellbooks-${activeAccount.pubkey}` : "none",
    activeAccount
      ? { kinds: [SPELLBOOK_KIND], authors: [activeAccount.pubkey] }
      : [],
    activeAccount?.relays?.map((r) => r.url) || [],
    { stream: true },
  );

  // Merge and deduplicate logic similar to SpellbooksViewer
  const spellbooks = useMemo(() => {
    if (!activeAccount) return [];

    const allMap = new Map<string, ParsedSpellbook>();

    // Process local ones first
    for (const s of localSpellbooks || []) {
      const parsed: ParsedSpellbook = {
        slug: s.slug,
        title: s.title,
        description: s.description,
        content: s.content,
        referencedSpells: [],
        event: s.event as SpellbookEvent,
      };
      allMap.set(s.slug, parsed);
    }

    // Merge network ones
    for (const event of networkEvents) {
      const slug = event.tags.find((t) => t[0] === "d")?.[1] || "";
      if (!slug) continue;

      const existing = allMap.get(slug);
      if (existing && event.created_at * 1000 <= (existing.event?.created_at || 0) * 1000) {
        continue;
      }

      try {
        const parsed = parseSpellbook(event as SpellbookEvent);
        allMap.set(slug, parsed);
      } catch (e) {
        // ignore
      }
    }

    return Array.from(allMap.values()).sort((a, b) => 
      a.title.localeCompare(b.title)
    );
  }, [localSpellbooks, networkEvents, activeAccount]);

  if (!activeAccount || (spellbooks.length === 0 && !networkLoading)) {
    return null;
  }

  const handleApply = (spellbook: ParsedSpellbook) => {
    loadSpellbook(spellbook);
    toast.success(`Layout "${spellbook.title}" applied`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-accent"
        >
          <BookHeart className={cn("size-4", networkLoading && "animate-pulse text-accent")} />
          <span className="text-xs font-medium hidden sm:inline">Spellbooks</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>My Spellbooks</span>
          {networkLoading && <Loader2 className="size-3 animate-spin" />}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {spellbooks.length === 0 && networkLoading && (
          <div className="p-4 text-center">
            <Loader2 className="size-4 animate-spin mx-auto mb-2 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        )}

        {spellbooks.map((sb) => (
          <DropdownMenuItem
            key={sb.slug}
            onClick={() => handleApply(sb)}
            className="cursor-pointer"
          >
            <Layout className="size-3.5 mr-2 text-muted-foreground" />
            <div className="flex flex-col min-w-0">
              <span className="truncate font-medium">{sb.title}</span>
              <span className="text-[10px] text-muted-foreground truncate">
                {Object.keys(sb.content.workspaces).length} tabs, {Object.keys(sb.content.windows).length} windows
              </span>
            </div>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => addWindow("spellbooks", {})}
          className="cursor-crosshair text-accent"
        >
          <BookHeart className="size-3.5 mr-2" />
          Manage Spellbooks
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
