/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOSTR_RELAY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
