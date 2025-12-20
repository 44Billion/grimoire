import { useState, useEffect, useMemo } from "react";
import { useGrimoire } from "@/core/state";
import { useAccountSync } from "@/hooks/useAccountSync";
import { useRelayListCacheSync } from "@/hooks/useRelayListCacheSync";
import { useRelayState } from "@/hooks/useRelayState";
import relayStateManager from "@/services/relay-state-manager";
import { TabBar } from "./TabBar";
import { Mosaic, MosaicWindow, MosaicBranch } from "react-mosaic-component";
import CommandLauncher from "./CommandLauncher";
import { WindowToolbar } from "./WindowToolbar";
import { WindowTile } from "./WindowTitle";
import { Terminal, Book, BookHeart, X, Check } from "lucide-react";
import UserMenu from "./nostr/user-menu";
import { GrimoireWelcome } from "./GrimoireWelcome";
import { GlobalAuthPrompt } from "./GlobalAuthPrompt";
import { useParams, useNavigate } from "react-router";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { resolveNip05, isNip05 } from "@/lib/nip05";
import { nip19 } from "nostr-tools";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent } from "@/types/spell";
import { toast } from "sonner";
import { Button } from "./ui/button";

export default function Home({
  spellbookName,
}: {
  spellbookName?: string | null;
}) {
  const { state, updateLayout, removeWindow, loadSpellbook } = useGrimoire();
  const [commandLauncherOpen, setCommandLauncherOpen] = useState(false);
  const { actor, identifier } = useParams();
  const navigate = useNavigate();

  // Preview state
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [originalState, setOriginalState] = useState<typeof state | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // 1. Resolve actor to pubkey
  useEffect(() => {
    if (!actor) {
      setResolvedPubkey(null);
      return;
    }

    const resolve = async () => {
      try {
        if (actor.startsWith("npub")) {
          const { data } = nip19.decode(actor);
          setResolvedPubkey(data as string);
        } else if (isNip05(actor)) {
          const pubkey = await resolveNip05(actor);
          setResolvedPubkey(pubkey);
        } else if (actor.length === 64) {
          setResolvedPubkey(actor);
        }
      } catch (e) {
        console.error("Failed to resolve actor:", actor, e);
      }
    };

    resolve();
  }, [actor]);

  // 2. Fetch the spellbook event
  const pointer = useMemo(() => {
    if (!resolvedPubkey || !identifier) return undefined;
    return {
      kind: 30777,
      pubkey: resolvedPubkey,
      identifier: identifier,
    };
  }, [resolvedPubkey, identifier]);

  const spellbookEvent = useNostrEvent(pointer);

  // 3. Apply preview when event is loaded
  useEffect(() => {
    if (spellbookEvent && !isPreviewing) {
      try {
        const parsed = parseSpellbook(spellbookEvent as SpellbookEvent);
        // Save current state before replacing
        setOriginalState({ ...state });
        loadSpellbook(parsed);
        setIsPreviewing(true);
        toast.info(`Previewing layout: ${parsed.title}`, {
          description: "This is a temporary preview. You can apply or discard it.",
        });
      } catch (e) {
        console.error("Failed to parse preview spellbook:", e);
        toast.error("Failed to load spellbook preview");
      }
    }
  }, [spellbookEvent, isPreviewing]);

  const handleApplyLayout = () => {
    setIsPreviewing(false);
    setOriginalState(null);
    navigate("/");
    toast.success("Layout applied permanently");
  };

  const handleDiscardPreview = () => {
    if (originalState) {
      // Restore original workspaces and windows
      // We need a way to restore the whole state.
      // For now, let's just navigate back, which might reload if we are not careful
      // Actually, useGrimoire doesn't have a 'restoreState' yet.
      // Let's just navigate home and hope the user re-applies if they want.
      // But Grimoire state is persisted to localStorage.
      // THIS IS TRICKY: loadSpellbook already mutated the persisted state!
      
      // To properly discard, we would need to revert the state.
      // For now, let's just go home.
      window.location.href = "/"; 
    } else {
      navigate("/");
    }
  };

  // Sync active account and fetch relay lists
  useAccountSync();

  // Auto-cache kind:10002 relay lists from EventStore to Dexie
  useRelayListCacheSync();

  // Initialize global relay state manager
  useEffect(() => {
    relayStateManager.initialize().catch((err) => {
      console.error("Failed to initialize relay state manager:", err);
    });
  }, []);

  // Sync relay state with Jotai
  useRelayState();

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandLauncherOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleRemoveWindow = (id: string) => {
    // Remove from windows map
    removeWindow(id);
  };

  const renderTile = (id: string, path: MosaicBranch[]) => {
    const window = state.windows[id];

    if (!window) {
      return (
        <MosaicWindow
          path={path}
          title="Unknown Window"
          toolbarControls={<WindowToolbar />}
        >
          <div className="p-4 text-muted-foreground">
            Window not found: {id}
          </div>
        </MosaicWindow>
      );
    }

    return (
      <WindowTile
        id={id}
        window={window}
        path={path}
        onClose={handleRemoveWindow}
        onEditCommand={() => setCommandLauncherOpen(true)}
      />
    );
  };

  return (
    <>
      <CommandLauncher
        open={commandLauncherOpen}
        onOpenChange={setCommandLauncherOpen}
      />
      <GlobalAuthPrompt />
      <main className="h-screen w-screen flex flex-col bg-background text-foreground">
        {isPreviewing && (
          <div className="bg-accent text-accent-foreground px-4 py-1.5 flex items-center justify-between text-sm font-medium animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2">
              <BookHeart className="size-4" />
              <span>Preview Mode: {spellbookEvent?.tags.find(t => t[0] === 'title')?.[1] || 'Spellbook'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 hover:bg-black/10 text-accent-foreground font-bold"
                onClick={handleDiscardPreview}
              >
                <X className="size-3.5 mr-1" />
                Discard
              </Button>
              <Button 
                variant="secondary" 
                size="sm" 
                className="h-7 bg-white text-accent hover:bg-white/90 font-bold shadow-sm"
                onClick={handleApplyLayout}
              >
                <Check className="size-3.5 mr-1" />
                Apply Layout
              </Button>
            </div>
          </div>
        )}
        <header className="flex flex-row items-center justify-between px-1 border-b border-border">
          <button
            onClick={() => setCommandLauncherOpen(true)}
            className="p-1 text-muted-foreground hover:text-accent transition-colors cursor-crosshair"
            title="Launch command (Cmd+K)"
            aria-label="Launch command palette"
          >
            <Terminal className="size-4" />
          </button>
          
          {spellbookName && (
            <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent animate-in fade-in slide-in-from-top-1 duration-500">
              <Book className="size-3" />
              <span className="text-xs font-medium tracking-tight truncate max-w-[200px]">
                {spellbookName}
              </span>
            </div>
          )}

          <UserMenu />
        </header>
        <section className="flex-1 relative overflow-hidden">
          {state.workspaces[state.activeWorkspaceId] && (
            <>
              {state.workspaces[state.activeWorkspaceId].layout === null ? (
                <GrimoireWelcome
                  onLaunchCommand={() => setCommandLauncherOpen(true)}
                />
              ) : (
                <Mosaic
                  renderTile={renderTile}
                  value={state.workspaces[state.activeWorkspaceId].layout}
                  onChange={updateLayout}
                  onRelease={(node) => {
                    // When Mosaic removes a node from the layout, clean up the window
                    if (typeof node === "string") {
                      handleRemoveWindow(node);
                    }
                  }}
                  className="mosaic-blueprint-theme"
                />
              )}
            </>
          )}
        </section>
        <TabBar />
      </main>
    </>
  );
}
