/**
 * Chrome's built-in Prompt API (`window.LanguageModel`), declared for the parts
 * grimoire uses.
 *
 * Not IPA: no origin permission prompt, no user-chosen provider or model. It is
 * a page-side fallback for when no injector is present, and must never be
 * assigned to `window.inference`.
 *
 * Trimmed to what this build actually exposes — `LanguageModel.params()` is
 * absent here, so nothing may depend on it.
 * https://developer.chrome.com/docs/ai/prompt-api
 */

export type PromptApiAvailability =
  "unavailable" | "downloadable" | "downloading" | "available";

export interface PromptApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Only the one event grimoire listens for; not an `EventTarget` widening. */
export interface PromptApiMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ): void;
}

export interface PromptApiCreateOptions {
  /** A system message may only be the first entry. */
  initialPrompts?: PromptApiMessage[];
  signal?: AbortSignal;
  monitor?: (monitor: PromptApiMonitor) => void;
}

export interface PromptApiSession {
  prompt(
    input: string | PromptApiMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  promptStreaming(
    input: string | PromptApiMessage[],
    options?: { signal?: AbortSignal },
  ): ReadableStream<string>;
  destroy(): void;
}

export interface PromptApi {
  availability(): Promise<PromptApiAvailability>;
  create(options?: PromptApiCreateOptions): Promise<PromptApiSession>;
}

declare global {
  var LanguageModel: PromptApi | undefined;
}
