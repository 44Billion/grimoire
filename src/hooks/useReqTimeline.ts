import { useState, useEffect, useMemo } from "react";
import pool from "@/services/relay-pool";
import type { NostrEvent, Filter } from "nostr-tools";

interface UseReqTimelineOptions {
  limit?: number;
  stream?: boolean;
}

interface UseReqTimelineReturn {
  events: NostrEvent[];
  loading: boolean;
  error: Error | null;
  eoseReceived: boolean;
}

/**
 * Hook for REQ command - queries ONLY specified relays using pool.req()
 * Stores results in memory (not EventStore) and returns them sorted by created_at
 * @param id - Unique identifier for this timeline (for caching)
 * @param filters - Nostr filter object
 * @param relays - Array of relay URLs (ONLY these relays will be queried)
 * @param options - Additional options like limit and stream (keep connection open after EOSE)
 * @returns Object containing events array (sorted newest first), loading state, and error
 */
export function useReqTimeline(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseReqTimelineOptions = { limit: 50 },
): UseReqTimelineReturn {
  const { limit, stream = false } = options;
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eoseReceived, setEoseReceived] = useState(false);

  // Use pool.req() directly to query relays
  useEffect(() => {
    if (relays.length === 0) {
      setLoading(false);
      setEvents([]);
      return;
    }

    console.log("REQ: Starting query", { relays, filters, limit, stream });
    setLoading(true);
    setError(null);
    setEoseReceived(false);

    const collectedEvents = new Map<string, NostrEvent>();

    // Normalize filters to array
    const filterArray = Array.isArray(filters) ? filters : [filters];

    // Add limit to filters if specified
    const filtersWithLimit = filterArray.map((f) => ({
      ...f,
      limit: limit || f.limit,
    }));

    // Use pool.req() for direct relay querying
    // pool.req() returns an Observable of events
    const observable = pool.req(relays, filtersWithLimit);

    const subscription = observable.subscribe(
      (response) => {
        // Response can be an event or 'EOSE' string
        if (typeof response === "string") {
          console.log("REQ: EOSE received");
          setEoseReceived(true);
          if (!stream) {
            setLoading(false);
          }
        } else {
          const event = response as NostrEvent;
          console.log("REQ: Event received", event.id);
          // Use Map to deduplicate by event ID
          collectedEvents.set(event.id, event);
          // Update state with deduplicated events
          setEvents(Array.from(collectedEvents.values()));
        }
      },
      (err: Error) => {
        console.error("REQ: Error", err);
        setError(err);
        setLoading(false);
      },
      () => {
        console.log("REQ: Query complete", {
          total: collectedEvents.size,
          stream,
        });
        // Only set loading to false if not streaming
        if (!stream) {
          setLoading(false);
        }
      },
    );

    // Set a timeout to prevent infinite loading (only for non-streaming queries)
    const timeout = !stream
      ? setTimeout(() => {
          console.warn("REQ: Query timeout, forcing completion");
          setLoading(false);
        }, 10000)
      : undefined;

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      subscription.unsubscribe();
    };
  }, [id, JSON.stringify(filters), relays.join(","), limit, stream]);

  // Sort events by created_at (newest first)
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
  }, [events]);

  return {
    events: sortedEvents,
    loading,
    error,
    eoseReceived,
  };
}
