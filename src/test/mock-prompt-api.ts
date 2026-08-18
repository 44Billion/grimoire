import type {
  PromptApi,
  PromptApiAvailability,
  PromptApiCreateOptions,
  PromptApiMessage,
  PromptApiSession,
} from "@/types/prompt-api";

/**
 * Chrome's Prompt API, mocked.
 *
 * Exists for the same reason as `mock-inference`: the API is a browser built-in,
 * so CI has none — and the behaviours that break an adapter are the awkward
 * ones. Chrome has shipped `promptStreaming` chunks both as deltas and as
 * full-text-so-far, so `chunkStyle` covers both; a model that has not been
 * downloaded reports `"downloadable"` and only starts on `create()`.
 */
export interface MockPromptApiOptions {
  availability?: PromptApiAvailability;
  /** Chunks the stream yields, as deltas. */
  chunks?: string[];
  /** How Chrome reports them. */
  chunkStyle?: "delta" | "cumulative";
  /** Thrown from `create()`. */
  createError?: unknown;
  /** Thrown from the stream. */
  streamError?: unknown;
}

export interface MockPromptApi extends PromptApi {
  /** Every `create()` call's options, for asserting the system prompt. */
  creates: PromptApiCreateOptions[];
  /** Every prompt sent, for asserting role mapping. */
  prompts: (string | PromptApiMessage[])[];
  /** Sessions destroyed, so a leak is visible. */
  destroyed: number;
  /** Fire download progress on the next `create()`. */
  downloadProgress: number[];
}

export function createMockPromptApi(
  options: MockPromptApiOptions = {},
): MockPromptApi {
  const chunks = options.chunks ?? ["hello ", "world"];
  const mock: MockPromptApi = {
    creates: [],
    prompts: [],
    destroyed: 0,
    downloadProgress: [],

    availability: () =>
      Promise.resolve(options.availability ?? ("available" as const)),

    create(createOptions?: PromptApiCreateOptions): Promise<PromptApiSession> {
      mock.creates.push(createOptions ?? {});
      if (createOptions?.signal?.aborted) {
        return Promise.reject(abortError());
      }
      if (mock.downloadProgress.length > 0 && createOptions?.monitor) {
        const listeners: ((event: { loaded: number }) => void)[] = [];
        createOptions.monitor({
          addEventListener: (_type, listener) => listeners.push(listener),
        });
        for (const loaded of mock.downloadProgress) {
          for (const listener of listeners) listener({ loaded });
        }
      }
      if (options.createError) return Promise.reject(options.createError);

      const session: PromptApiSession = {
        prompt: (input) => {
          mock.prompts.push(input);
          return Promise.resolve(chunks.join(""));
        },
        promptStreaming: (input, streamOptions) => {
          mock.prompts.push(input);
          return streamOf(chunks, {
            cumulative: options.chunkStyle === "cumulative",
            error: options.streamError,
            signal: streamOptions?.signal,
          });
        },
        destroy: () => {
          mock.destroyed += 1;
        },
      };
      return Promise.resolve(session);
    },
  };

  return mock;
}

function streamOf(
  chunks: string[],
  options: { cumulative: boolean; error?: unknown; signal?: AbortSignal },
): ReadableStream<string> {
  let index = 0;
  let sent = "";
  return new ReadableStream<string>({
    pull(controller) {
      if (options.signal?.aborted) {
        controller.error(abortError());
        return;
      }
      if (index >= chunks.length) {
        if (options.error) controller.error(options.error);
        else controller.close();
        return;
      }
      const delta = chunks[index++];
      sent += delta;
      controller.enqueue(options.cumulative ? sent : delta);
    },
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** Install onto `globalThis.LanguageModel`. Returns a restore function. */
export function installMockPromptApi(mock: PromptApi | undefined): () => void {
  const scope = globalThis as { LanguageModel?: PromptApi };
  const previous = scope.LanguageModel;
  scope.LanguageModel = mock;
  return () => {
    scope.LanguageModel = previous;
  };
}
