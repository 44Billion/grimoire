import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { parseProfileCommand } from "@/lib/profile-parser";
import { addressLoader } from "@/services/loaders";
import { SPELLBOOK_KIND } from "@/constants/kinds";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { useGrimoire } from "@/core/state";
import Home from "./Home";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";

export default function SpellbookLoader() {
  const { user, identifier } = useParams();
  const { loadSpellbook, state } = useGrimoire();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);

  useEffect(() => {
    async function resolveAndLoad() {
      if (!user || !identifier) return;

      try {
        setLoading(true);
        setError(null);

        // 1. Resolve user to pubkey
        const { pubkey } = await parseProfileCommand([user], state.activeAccount?.pubkey);

        // 2. Load spellbook event
        const event$ = addressLoader({
          kind: SPELLBOOK_KIND,
          pubkey,
          identifier,
        });

        // addressLoader returns an observable, we need to wait for the first value
        const event = await new Promise<any>((resolve, reject) => {
          const sub = event$.subscribe({
            next: (ev) => {
              if (ev) {
                sub.unsubscribe();
                resolve(ev);
              }
            },
            error: reject,
          });
          
          // Timeout after 10 seconds
          setTimeout(() => {
            sub.unsubscribe();
            reject(new Error("Timeout loading spellbook"));
          }, 10000);
        });

        if (!event) {
          throw new Error("Spellbook not found");
        }

        // 3. Parse and load
        const parsed = parseSpellbook(event);
        loadSpellbook(parsed);
        setLoadedSlug(`${parsed.title} by ${user}`);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load spellbook:", err);
        setError(err instanceof Error ? err.message : "Failed to load spellbook");
        setLoading(false);
      }
    }

    resolveAndLoad();
  }, [user, identifier, loadSpellbook, state.activeAccount?.pubkey]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-lg font-medium">Resolving spellbook...</p>
        <p className="text-muted-foreground mt-2">@{user}/{identifier}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground p-6 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Failed to load spellbook</h1>
        <p className="text-muted-foreground max-w-md mb-6">{error}</p>
        <div className="flex gap-4">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Button variant="outline" asChild>
            <a href="/">Go to Home</a>
          </Button>
        </div>
      </div>
    );
  }

  // Once loaded, we just render Home, but maybe we should use a redirect to clear the URL?
  // Actually, the user wants the route to exist.
  return <Home spellbookName={loadedSlug} />;
}
