/**
 * Inference Provider API (IPA) — `window.inference`, injected by a browser or
 * extension. Vendored from the Experimental Draft spec rather than depending on
 * `ipa-tools` 0.x: the types are the whole contract and carry no runtime.
 *
 * https://github.com/SamSamskies/inference-provider-api/blob/main/SPEC.md
 */

export type InferenceRequest = {
  method: "chat";
  messages: InferenceMessage[];
  /** Function tools. Only when getFeatures().toolCalling is true. */
  tools?: InferenceTool[];
  toolChoice?: ToolChoice;
  options?: InferenceOptions;
  signal?: AbortSignal;
};

export type InferenceOptions = {
  /** Thinking budget. Distinct from `message.reasoning`, which is output. */
  reasoningEffort?: ReasoningEffort;
  /** Sampling temperature in `[0, 2]` (OpenAI scale). */
  temperature?: number;
};

/** Omitted or `"auto"` means the provider default. */
export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high";

export type InferenceMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      /** Chain-of-thought, when the provider exposes it. */
      reasoning?: string;
      toolCalls?: ToolCall[];
    }
  | { role: "tool"; toolCallId: string; content: string };

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type InferenceChunk =
  | { type: "accepted" }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | {
      type: "done";
      model: string;
      message: InferenceMessage;
      usage?: Usage;
    };

export type InferenceFeatures = {
  /** Accepts tools, toolChoice, and tool messages. Absent means unsupported. */
  toolCalling?: boolean;
  /** Advertised per key; a bare `{}` advertises none. */
  options?: {
    reasoningEffort?: boolean;
    temperature?: boolean;
  };
};

export type InferenceTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON Schema object for the function arguments. */
    parameters?: { [key: string]: unknown };
  };
};

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded argument object. */
    arguments: string;
  };
};

export type InferenceErrorCode =
  | "permission_denied"
  | "invalid_request"
  | "unavailable"
  | "provider_error"
  | "aborted";

export type InferenceError = Error & { code: InferenceErrorCode };

export type Inference = {
  request(request: InferenceRequest): AsyncIterable<InferenceChunk>;
  getFeatures?(): InferenceFeatures;
};

export type DoneChunk = Extract<InferenceChunk, { type: "done" }>;

declare global {
  interface Window {
    inference?: Inference;
  }
}
