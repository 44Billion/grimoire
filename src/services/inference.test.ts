import { describe, expect, it, afterEach } from "vitest";

import {
  complete,
  describeInferenceError,
  getInference,
  getInferenceFeatures,
  isInferenceAvailable,
  isInferenceError,
} from "./inference";
import {
  createMockInference,
  installMockInference,
} from "@/test/mock-inference";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("availability", () => {
  it("reports unavailable with no injector", () => {
    restore = installMockInference(undefined);
    expect(isInferenceAvailable()).toBe(false);
    expect(() => getInference()).toThrowError(/not available/);
  });

  it("throws `unavailable`, not a bare Error", () => {
    restore = installMockInference(undefined);
    try {
      getInference();
      expect.unreachable();
    } catch (error) {
      expect(isInferenceError(error)).toBe(true);
      expect(isInferenceError(error) && error.code).toBe("unavailable");
    }
  });

  it("advertises nothing when getFeatures is missing", () => {
    const mock = createMockInference({ kind: "normal" });
    delete mock.getFeatures;
    restore = installMockInference(mock);
    expect(getInferenceFeatures()).toEqual({});
  });

  it("passes a feature snapshot through", () => {
    restore = installMockInference(
      createMockInference(
        { kind: "normal" },
        { toolCalling: true, options: { temperature: true } },
      ),
    );
    const features = getInferenceFeatures();
    expect(features.toolCalling).toBe(true);
    expect(features.options?.temperature).toBe(true);
    // Absent key means unsupported, never "assume yes".
    expect(features.options?.reasoningEffort).toBeUndefined();
  });
});

describe("complete", () => {
  it("concatenated deltas equal done.message.content", async () => {
    restore = installMockInference(
      createMockInference({
        kind: "normal",
        deltas: ["Nos", "tr is ", "fine"],
      }),
    );
    const done = await complete({
      method: "chat",
      messages: [{ role: "user", content: "Is Nostr dead?" }],
    });
    expect(done.message.content).toBe("Nostr is fine");
    expect(done.model).toBe("mock-model");
  });

  it("reasoning stays out of content", async () => {
    restore = installMockInference(
      createMockInference({
        kind: "normal",
        deltas: ["no"],
        reasoning: ["thinking", " harder"],
      }),
    );
    const done = await complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(done.message.content).toBe("no");
    expect(
      done.message.role === "assistant" ? done.message.reasoning : undefined,
    ).toBe("thinking harder");
  });

  it("a stream that ends without done is a provider_error", async () => {
    restore = installMockInference(
      createMockInference({ kind: "no-done", deltas: ["half"] }),
    );
    await expect(
      complete({ method: "chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "provider_error" });
  });

  it("recognizes an error reconstructed across an isolated world", async () => {
    restore = installMockInference(
      createMockInference({ kind: "error", code: "permission_denied" }),
    );
    try {
      await complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
      });
      expect.unreachable();
    } catch (error) {
      // The injector hands back a plain object, so instanceof is useless.
      expect(error instanceof Error).toBe(false);
      expect(isInferenceError(error)).toBe(true);
      expect(describeInferenceError(error)).toMatch(/denied/);
    }
  });

  it("aborts a hanging provider", async () => {
    restore = installMockInference(createMockInference({ kind: "hang" }));
    const controller = new AbortController();
    const pending = complete({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("refuses to start when already aborted", async () => {
    restore = installMockInference(
      createMockInference({ kind: "normal", deltas: ["x"] }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      complete({
        method: "chat",
        messages: [{ role: "user", content: "hi" }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
