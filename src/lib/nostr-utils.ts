import type { ProfileContent } from "applesauce-core/helpers";

export function derivePlaceholderName(pubkey: string): string {
  return `${pubkey.slice(0, 4)}:${pubkey.slice(-4)}`;
}

export function getDisplayName(
  pubkey: string,
  metadata?: ProfileContent,
): string {
  if (metadata?.display_name) {
    return metadata.display_name;
  }
  if (metadata?.name) {
    return metadata.name;
  }
  return derivePlaceholderName(pubkey);
}
