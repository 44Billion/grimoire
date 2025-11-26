// Nostr Profile Metadata (Kind 0 event content)
export interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
  website?: string;
  [key: string]: string | undefined; // Allow additional fields
}

export interface ProfileData {
  pubkey: string;
  metadata: ProfileMetadata | null;
  loading: boolean;
  error: Error | null;
}
