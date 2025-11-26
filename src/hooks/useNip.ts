import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { getNipUrl } from "@/constants/nips";

interface UseNipResult {
  content: string | null;
  loading: boolean;
  error: Error | null;
}

export function useNip(nipId: string): UseNipResult {
  const [error, setError] = useState<Error | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  // Live query that reactively updates when the NIP is cached
  const cached = useLiveQuery(() => db.nips.get(nipId), [nipId]);

  useEffect(() => {
    // If we already have it cached or are currently fetching, don't fetch again
    if (cached || isFetching) return;

    let isMounted = true;
    setIsFetching(true);

    async function fetchNip() {
      try {
        setError(null);

        // Fetch from GitHub
        const url = getNipUrl(nipId);
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch NIP-${nipId}: ${response.statusText}`,
          );
        }

        const markdown = await response.text();

        // Cache the result (live query will auto-update)
        await db.nips.put({
          id: nipId,
          content: markdown,
          fetchedAt: Date.now(),
        });

        if (isMounted) {
          setIsFetching(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error("Unknown error"));
          setIsFetching(false);
        }
      }
    }

    fetchNip();

    return () => {
      isMounted = false;
    };
  }, [nipId, cached, isFetching]);

  return {
    content: cached?.content ?? null,
    loading: !cached && isFetching,
    error,
  };
}
