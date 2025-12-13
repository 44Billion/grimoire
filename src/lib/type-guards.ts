import type { NostrEvent } from "nostr-tools";
import type { AuthPreference } from "@/types/relay-state";

/**
 * Type guard to check if a value is a valid Nostr event
 */
export function isNostrEvent(value: unknown): value is NostrEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    typeof event.created_at === "number" &&
    typeof event.kind === "number" &&
    Array.isArray(event.tags) &&
    typeof event.content === "string" &&
    typeof event.sig === "string"
  );
}

/**
 * Type guard to check if a string is a valid AuthPreference
 */
export function isAuthPreference(value: string): value is AuthPreference {
  return value === "always" || value === "never" || value === "ask";
}
