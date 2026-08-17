import type {
  Inference,
  InferenceChunk,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceRequest,
} from "@/types/inference";

/**
 * Minimal `window.inference` injector for tests.
 *
 * Exists for the same reason as mock-relay: the behaviours that break a client
 * are the awkward ones. An IPA implementation is a browser extension, so CI has
 * none — and the failure modes that matter (a stream that ends without `done`,
 * an error reconstructed across an isolated world so `instanceof` fails, an
 * abort mid-stream) cannot be produced by a well-behaved provider.
 */
export type MockInferenceBehaviour =
  /** Stream `deltas`, then a `done` whose content is their concatenation. */
  | { kind: "normal"; deltas?: string[]; reasoning?: string[]; model?: string }
  /** Deltas, then the stream just ends. No `done` — a spec violation. */
  | { kind: "no-done"; deltas?: string[] }
  /**
   * Throw after `accepted`. The error is a plain object with a `code`, exactly
   * as an extension reconstructs it — `instanceof Error` is false.
   */
  | { kind: "error"; code: InferenceErrorCode; message?: string }
  /** Never yields anything after `accepted`; only an abort ends it. */
  | { kind: "hang" }
  /**
   * Answer with tool calls on each listed round, then with text. Lets the
   * page-side tool loop be exercised without an injector that advertises
   * toolCalling — no shipped one does yet.
   */
  | {
      kind: "tool-calls";
      /** One entry per round; an empty array ends the loop with `text`. */
      rounds: Array<Array<{ name: string; arguments?: string }>>;
      text?: string;
    };

export interface MockInference extends Inference {
  /** Requests received, for asserting the caller isn't re-requesting. */
  requests: InferenceRequest[];
}

/**
 * Build a mock `Inference`. Install with `installMockInference` or pass its
 * `request` directly.
 */
export function createMockInference(
  behaviour: MockInferenceBehaviour,
  features: InferenceFeatures = {},
): MockInference {
  const requests: InferenceRequest[] = [];
  let round = 0;

  return {
    requests,
    getFeatures: () => features,
    request(request: InferenceRequest): AsyncIterable<InferenceChunk> {
      requests.push(request);
      return {
        async *[Symbol.asyncIterator]() {
          throwIfAborted(request);
          yield { type: "accepted" };

          if (behaviour.kind === "tool-calls") {
            const calls = behaviour.rounds[round] ?? [];
            round++;
            if (calls.length > 0) {
              yield {
                type: "done",
                model: "mock-model",
                message: {
                  role: "assistant",
                  content: null,
                  toolCalls: calls.map((call, index) => ({
                    id: `call-${round}-${index}`,
                    type: "function",
                    function: {
                      name: call.name,
                      arguments: call.arguments ?? "{}",
                    },
                  })),
                },
              };
              return;
            }
            const text = behaviour.text ?? "done";
            yield { type: "delta", content: text };
            yield {
              type: "done",
              model: "mock-model",
              message: { role: "assistant", content: text },
              usage: { inputTokens: 1, outputTokens: 1 },
            };
            return;
          }

          if (behaviour.kind === "hang") {
            await new Promise<void>((_resolve, reject) => {
              // Re-check inside the promise: abort can land between the
              // generator starting and this listener being attached.
              throwIfAborted(request);
              request.signal?.addEventListener(
                "abort",
                () => reject(reconstructedError("aborted", "Request aborted")),
                { once: true },
              );
            });
            return;
          }

          if (behaviour.kind === "error") {
            throw reconstructedError(behaviour.code, behaviour.message);
          }

          const reasoning =
            behaviour.kind === "normal" ? (behaviour.reasoning ?? []) : [];
          for (const content of reasoning) {
            throwIfAborted(request);
            yield { type: "reasoning_delta", content };
          }

          const deltas = behaviour.deltas ?? [];
          for (const content of deltas) {
            throwIfAborted(request);
            yield { type: "delta", content };
          }

          if (behaviour.kind === "no-done") return;

          throwIfAborted(request);
          yield {
            type: "done",
            model: behaviour.model ?? "mock-model",
            message: {
              role: "assistant",
              content: deltas.join("") || null,
              ...(reasoning.length ? { reasoning: reasoning.join("") } : {}),
            },
            usage: { inputTokens: 1, outputTokens: deltas.length },
          };
        },
      };
    },
  };
}

/**
 * Install onto `window.inference`. Returns a restore function.
 * Vitest runs in the node environment, so `window` is stubbed when absent.
 */
export function installMockInference(mock: Inference | undefined): () => void {
  const scope = globalThis as { window?: { inference?: Inference } };
  const hadWindow = scope.window !== undefined;
  if (!hadWindow) scope.window = {};
  const target = scope.window!;
  const previous = target.inference;
  target.inference = mock;
  return () => {
    if (!hadWindow) {
      scope.window = undefined;
      return;
    }
    target.inference = previous;
  };
}

function throwIfAborted(request: InferenceRequest): void {
  if (request.signal?.aborted) {
    throw reconstructedError("aborted", "Request aborted");
  }
}

/**
 * An error as an extension delivers it: a structured-clone-safe object with a
 * `code`, not an `Error` subclass. Anything matching on `instanceof` fails here.
 */
function reconstructedError(code: InferenceErrorCode, message?: string) {
  return { name: "InferenceError", message: message ?? code, code };
}
