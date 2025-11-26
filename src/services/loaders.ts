import {
  createEventLoader,
  createAddressLoader,
  createTimelineLoader,
} from "applesauce-loaders/loaders";
import pool from "./relay-pool";
import eventStore from "./event-store";

// Aggregator relays for better event discovery
export const AGGREGATOR_RELAYS = [
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://purplepag.es",
  "wss://relay.primal.net",
];

// Event loader for fetching single events by ID
export const eventLoader = createEventLoader(pool, {
  eventStore,
  extraRelays: AGGREGATOR_RELAYS,
});

// Address loader for replaceable events (profiles, relay lists, etc.)
export const addressLoader = createAddressLoader(pool, {
  eventStore,
  extraRelays: AGGREGATOR_RELAYS,
});

// Profile loader with batching - combines multiple profile requests within 200ms
export const profileLoader = createAddressLoader(pool, {
  eventStore,
  bufferTime: 200, // Batch requests within 200ms window
  extraRelays: AGGREGATOR_RELAYS,
});

// Timeline loader factory - creates loader for event feeds
export { createTimelineLoader };
