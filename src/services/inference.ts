/**
 * Inference Provider API access, plus the one fallback grimoire ships.
 *
 * Not a singleton — `window.inference` is injected by an extension, so IPA is a
 * lookup, not state we own. The fallback client is a singleton, because it holds
 * one on-device model session.
 *
 * Errors carry a `code`; match on that, never `instanceof`. Injectors
 * reconstruct the error across isolated worlds, so the prototype is lost.
 */

import {
  createInference,
  getInference as getIpaInference,
  isInferenceAvailable as isIpaAvailable,
  isInferenceError,
  makeInferenceError,
  type InferenceClient,
} from "ipa-tools";

import {
  createPromptApiBackend,
  isPromptApiPresent,
  promptApiAvailability,
  PROMPT_API_ID,
} from "./prompt-api";

import type { BackendAvailability } from "ipa-tools";
import type {
  DoneChunk,
  Inference,
  InferenceFeatures,
  InferenceRequest,
} from "@/types/inference";

// Re-exported so callers keep one import site for the whole surface.
export {
  isInferenceError,
  makeInferenceError,
  serializeToolResult,
} from "ipa-tools";

/**
 * Parse a tool call's arguments. Empty means no arguments, not an error —
 * providers send `""` for a zero-argument call.
 *
 * Not `ipa-tools`' version, which throws `invalid_request` on malformed JSON:
 * that ends the turn, where the loop here hands the model an error result it
 * can correct from. A model that mangles its own arguments should get a chance
 * to notice.
 */
export function parseToolArguments(json: string | undefined): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Human-readable reason for a failed request, for surfacing in a window. */
export function describeInferenceError(error: unknown): string {
  if (!isInferenceError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case "unavailable":
      return "No inference provider is available. Install an extension that injects window.inference.";
    case "permission_denied":
      return "This origin was denied access to inference.";
    case "invalid_request":
      return `The provider rejected the request: ${error.message}`;
    case "aborted":
      return "Request cancelled.";
    default:
      return error.message || "The provider failed.";
  }
}

/**
 * True when an injector is present. Synchronous, so it can gate a menu item —
 * the fallback's availability is asynchronous, see {@link probeInference}.
 */
export function isInferenceAvailable(): boolean {
  return isIpaAvailable();
}

/** True when anything can answer, injector or on-device model. */
export function isAnyInferenceReachable(): boolean {
  return isIpaAvailable() || isPromptApiPresent();
}

export function getInference(): Inference {
  // `ipa-tools` types `window.inference` without the experimental namespace,
  // which is real and the only way to send tools today.
  return getIpaInference() as Inference;
}

/**
 * Capability snapshot. Absent `getFeatures` advertises nothing, and the result
 * never names a provider or model — the extension owns that choice.
 */
export function getInferenceFeatures(): InferenceFeatures {
  if (!isIpaAvailable()) return {};
  return getInference().getFeatures?.() ?? {};
}

/** Progress of the on-device model download, in bytes, while one is running. */
let downloadProgress: ((loaded: number) => void) | undefined;

/** Set the sink for on-device download progress. Replaces any previous one. */
export function onModelDownloadProgress(
  listener: ((loaded: number) => void) | undefined,
): void {
  downloadProgress = listener;
}

/**
 * IPA first, on-device second — `createInference` re-checks the injector around
 * every probe and create, so an extension that appears late still wins.
 *
 * One client for the app: it caches the resolved backend, and the on-device
 * model is a download nobody wants twice.
 */
let client: InferenceClient | undefined;

function fallbackClient(): InferenceClient {
  client ??= createInference({
    fallbacks: [createPromptApiBackend()],
    onDownloadProgress: (loaded) => downloadProgress?.(loaded),
  });
  return client;
}

export interface InferenceReach {
  /** An injector is present. */
  ipa: boolean;
  /** State of the on-device fallback. */
  fallback: BackendAvailability;
}

/**
 * What can answer right now. Asynchronous because the on-device model reports
 * four states, one of which is a download that has not happened yet.
 */
export async function probeInference(): Promise<InferenceReach> {
  const status = await fallbackClient().probe();
  return {
    ipa: status.ipa === "available",
    fallback: (status[PROMPT_API_ID] as BackendAvailability) ?? "unavailable",
  };
}

/** Availability of the on-device model alone, without probing the injector. */
export { promptApiAvailability };

/**
 * How this window may send tools, if at all.
 *
 * `"standard"` is a spec-advertised capability. `"experimental"` means the
 * injector only offers tools on its own namespace — usable, but a surface the
 * spec asks applications not to depend on, so callers must say so.
 */
export type ToolSupport = "standard" | "experimental" | "none";

export interface ResolvedRequest {
  request: Inference["request"];
  tools: ToolSupport;
  /** True when the answer will come from the page's own model, not an injector. */
  onDevice?: boolean;
}

/**
 * Pick the request function to use.
 *
 * IPA is decided here rather than inside the client because the experimental
 * namespace is injector-specific: the client only knows `request`, so routing
 * an injected provider through it would silently drop tool calling.
 */
export function resolveRequest(): ResolvedRequest {
  if (!isIpaAvailable()) {
    // No injector. The client resolves the fallback lazily, inside the request,
    // and re-checks IPA on the way — so a late injection still wins.
    const fallback = fallbackClient();
    return {
      request: (request) => fallback.request(request),
      tools: "none",
      onDevice: true,
    };
  }

  const inference = getInference();
  const standard = inference.request.bind(inference);

  if (inference.getFeatures?.().toolCalling === true) {
    return { request: standard, tools: "standard" };
  }

  const experimental = inference.experimental?.request;
  if (typeof experimental === "function") {
    return {
      request: experimental.bind(inference.experimental),
      tools: "experimental",
    };
  }

  return { request: standard, tools: "none" };
}

/** Drain a stream to its single `done` chunk, ignoring deltas. */
export async function complete(request: InferenceRequest): Promise<DoneChunk> {
  let done: DoneChunk | undefined;
  for await (const chunk of resolveRequest().request(request)) {
    if (chunk.type === "done") done = chunk;
  }
  if (!done) {
    if (request.signal?.aborted) {
      throw makeInferenceError("aborted", "Request cancelled.");
    }
    throw makeInferenceError(
      "provider_error",
      "Stream ended without a done chunk.",
    );
  }
  return done;
}
