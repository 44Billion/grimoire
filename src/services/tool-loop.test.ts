import { describe, expect, it, vi } from "vitest";

import { runToolLoop } from "./tool-loop";
import { createMockInference } from "@/test/mock-inference";
import type { InferenceMessage } from "@/types/inference";

const messages: InferenceMessage[] = [{ role: "user", content: "go" }];

const tools = [
  {
    type: "function" as const,
    function: { name: "lookup", description: "", parameters: {} },
  },
];

describe("runToolLoop", () => {
  it("returns the text answer when no tool is called", async () => {
    const mock = createMockInference({
      kind: "normal",
      deltas: ["hi ", "there"],
    });
    const result = await runToolLoop({
      messages,
      request: mock.request,
    });
    expect(result.content).toBe("hi there");
    expect(result.toolRuns).toEqual([]);
  });

  it("runs a call and feeds the result back", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      rounds: [[{ name: "lookup", arguments: '{"nip":"01"}' }], []],
      text: "NIP-01 defines events.",
    });
    const lookup = vi.fn().mockResolvedValue({ text: "spec" });

    const result = await runToolLoop({
      messages,
      request: mock.request,
      tools,
      executors: { lookup },
    });

    expect(lookup).toHaveBeenCalledWith({ nip: "01" });
    expect(result.content).toBe("NIP-01 defines events.");
    expect(result.toolRuns).toEqual([
      {
        name: "lookup",
        input: { nip: "01" },
        output: { text: "spec" },
        state: "output-available",
      },
    ]);

    // The second request carries the assistant turn and the tool result.
    const second = mock.requests[1].messages;
    expect(second[second.length - 1]).toMatchObject({
      role: "tool",
      content: '{"text":"spec"}',
    });
    expect(second[second.length - 2]).toMatchObject({ role: "assistant" });
  });

  it("omits tools entirely when none are supplied", async () => {
    const mock = createMockInference({ kind: "normal", deltas: ["x"] });
    await runToolLoop({ messages, request: mock.request });
    // Sending `tools` without a toolCalling advertisement is invalid_request.
    expect("tools" in mock.requests[0]).toBe(false);
  });

  it("reports a failing tool to the model instead of throwing", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      rounds: [[{ name: "lookup" }], []],
      text: "could not look that up",
    });
    const lookup = vi.fn().mockRejectedValue(new Error("relay is down"));

    const result = await runToolLoop({
      messages,
      request: mock.request,
      tools,
      executors: { lookup },
    });

    expect(result.toolRuns[0]).toMatchObject({
      state: "output-error",
      errorText: "relay is down",
    });
    const sent = mock.requests[1].messages;
    expect(sent[sent.length - 1].content).toContain("relay is down");
  });

  it("tells the model when it asks for a tool that does not exist", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      rounds: [[{ name: "rm_rf" }], []],
      text: "ok",
    });

    const result = await runToolLoop({
      messages,
      request: mock.request,
      tools,
      executors: {},
    });

    expect(result.toolRuns[0]).toMatchObject({
      state: "output-error",
      errorText: "No such tool: rm_rf",
    });
  });

  it("stops a model that will not stop calling", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      // Always calls, never answers.
      rounds: Array.from({ length: 20 }, () => [{ name: "lookup" }]),
    });
    const lookup = vi.fn().mockResolvedValue({});

    await expect(
      runToolLoop({
        maxRounds: 3,
        messages,
        request: mock.request,
        tools,
        executors: { lookup },
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("reports each run as it starts and finishes", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      rounds: [[{ name: "lookup" }], []],
      text: "ok",
    });
    const states: string[] = [];

    await runToolLoop({
      messages,
      request: mock.request,
      tools,
      executors: { lookup: () => Promise.resolve("ok") },
      onToolRuns: (runs) => states.push(runs.map((r) => r.state).join(",")),
    });

    expect(states).toEqual(["input-available", "output-available"]);
  });

  it("aborts between rounds", async () => {
    const mock = createMockInference({
      kind: "tool-calls",
      rounds: [[{ name: "lookup" }], []],
      text: "ok",
    });
    const controller = new AbortController();

    await expect(
      runToolLoop({
        messages,
        request: mock.request,
        signal: controller.signal,
        tools,
        executors: {
          lookup: () => {
            controller.abort();
            return Promise.resolve("ok");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("treats a stream with no done chunk as a provider error", async () => {
    const mock = createMockInference({ kind: "no-done", deltas: ["half"] });
    await expect(
      runToolLoop({ messages, request: mock.request }),
    ).rejects.toMatchObject({ code: "provider_error" });
  });
});
