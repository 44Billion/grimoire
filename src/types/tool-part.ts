/**
 * Tool-call view state for the ai-elements `Tool` components.
 *
 * Upstream imports these from the `ai` package, which is 8MB of AI SDK for two
 * type aliases. IPA relays tool calls itself — `done.message.toolCalls` and
 * `role: "tool"` results — so the SDK has no runtime role here either.
 *
 * `approval-*` and `output-denied` are carried because the vendored components
 * render them; IPA has no approval round today, and a page must not invent one
 * (consent belongs to the extension's permission prompt).
 */

/** One executed tool call, as the loop reports it and the UI renders it. */
export interface ToolRun {
  name: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
  state: ToolCallState;
}

export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-denied"
  | "output-error";

interface ToolPartBase {
  state: ToolCallState;
  /** Parsed arguments. Unknown because a tool defines its own schema. */
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
}

/** A named tool, typed as `tool-<name>` so the header can derive the name. */
export interface ToolUIPart extends ToolPartBase {
  type: `tool-${string}`;
}

/** A tool whose name is only known at runtime. */
export interface DynamicToolUIPart extends ToolPartBase {
  type: "dynamic-tool";
  toolName: string;
}
