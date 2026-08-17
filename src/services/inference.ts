/**
 * Inference Provider API access. Not a singleton — `window.inference` is
 * injected by an extension, so this is a lookup, not state we own.
 *
 * Errors carry a `code`; match on that, never `instanceof`. Injectors
 * reconstruct the error across isolated worlds, so the prototype is lost.
 */

import type {
  DoneChunk,
  Inference,
  InferenceError,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceRequest,
} from "@/types/inference";

const INFERENCE_ERROR_CODES: ReadonlySet<string> = new Set([
  "permission_denied",
  "invalid_request",
  "unavailable",
  "provider_error",
  "aborted",
]);

export function makeInferenceError(
  code: InferenceErrorCode,
  message?: string,
): InferenceError {
  const error = new Error(message || code) as InferenceError;
  error.name = "InferenceError";
  error.code = code;
  return error;
}

export function isInferenceError(error: unknown): error is InferenceError {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && INFERENCE_ERROR_CODES.has(code);
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

function lookup(): Inference | undefined {
  const inference = globalThis.window?.inference;
  return inference != null && typeof inference.request === "function"
    ? inference
    : undefined;
}

export function isInferenceAvailable(): boolean {
  return lookup() != null;
}

export function getInference(): Inference {
  const inference = lookup();
  if (!inference) {
    throw makeInferenceError(
      "unavailable",
      "window.inference is not available.",
    );
  }
  return inference;
}

/**
 * Capability snapshot. Absent `getFeatures` advertises nothing, and the result
 * never names a provider or model — the extension owns that choice.
 */
export function getInferenceFeatures(): InferenceFeatures {
  return lookup()?.getFeatures?.() ?? {};
}

/** Drain a stream to its single `done` chunk, ignoring deltas. */
export async function complete(request: InferenceRequest): Promise<DoneChunk> {
  let done: DoneChunk | undefined;
  for await (const chunk of getInference().request(request)) {
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
