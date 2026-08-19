import { describe, expect, it, afterEach } from "vitest";

import {
  complete,
  describeInferenceError,
  getInference,
  getInferenceFeatures,
  isAnyInferenceReachable,
  isInferenceAvailable,
  isInferenceError,
  listBackends,
  probeInference,
  resolveRequest,
} from "./inference";
import {
  createMockInference,
  installMockInference,
} from "@/test/mock-inference";
import {
  createMockPromptApi,
  installMockPromptApi,
} from "@/test/mock-prompt-api";

import type { InferenceChunk } from "@/types/inference";

let restore: (() => void) | undefined;
let restorePromptApi: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  restorePromptApi?.();
  restorePromptApi = undefined;
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

describe("the on-device fallback", () => {
  it("is not reachable when neither an injector nor the browser can answer", async () => {
    restore = installMockInference(undefined);
    restorePromptApi = installMockPromptApi(undefined);
    expect(isAnyInferenceReachable()).toBe(false);
    expect(await probeInference()).toEqual({
      ipa: false,
      fallback: "unavailable",
    });
  });

  it("counts the browser's own model as reachable, injector or not", () => {
    restore = installMockInference(undefined);
    restorePromptApi = installMockPromptApi(createMockPromptApi());
    expect(isInferenceAvailable()).toBe(false);
    expect(isAnyInferenceReachable()).toBe(true);
  });

  it("answers from the browser when no injector is present, without tools", async () => {
    restore = installMockInference(undefined);
    restorePromptApi = installMockPromptApi(
      createMockPromptApi({ chunks: ["on ", "device"] }),
    );

    const resolved = resolveRequest();
    expect(resolved.tools).toBe("none");
    expect(resolved.onDevice).toBe(true);

    const chunks: InferenceChunk[] = [];
    for await (const chunk of resolved.request({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: "done",
      message: { content: "on device" },
    });
  });

  it("prefers the injector when there is one, and never marks it on-device", () => {
    restorePromptApi = installMockPromptApi(createMockPromptApi());
    restore = installMockInference(
      createMockInference(
        { kind: "normal", deltas: ["x"] },
        { toolCalling: true },
      ),
    );

    const resolved = resolveRequest();
    expect(resolved.tools).toBe("standard");
    expect(resolved.onDevice).toBeUndefined();
  });
});

describe("a backend preference", () => {
  it("answers on-device even with an injector present", async () => {
    // The whole reason this cannot go through `ipa-tools`' client: its resolver
    // is IPA-first and refuses `"ipa"` as a fallback entry, so with an extension
    // installed the preference would silently do nothing.
    restore = installMockInference(
      createMockInference(
        { kind: "normal", deltas: ["from the extension"] },
        { toolCalling: true },
      ),
    );
    restorePromptApi = installMockPromptApi(
      createMockPromptApi({ chunks: ["on ", "device"] }),
    );

    const resolved = resolveRequest("promptApi");
    expect(resolved.onDevice).toBe(true);
    // On-device means no tools, whatever the extension advertises.
    expect(resolved.tools).toBe("none");
    expect(resolved.substituted).toBeUndefined();

    const chunks: InferenceChunk[] = [];
    for await (const chunk of resolved.request({
      method: "chat",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: "done",
      message: { content: "on device" },
    });
  });

  it("falls back and says so when the chosen backend is missing", () => {
    // A preference is a preference: nothing failed, so nothing throws — but the
    // window has to be able to say which one answered.
    restorePromptApi = installMockPromptApi(undefined);
    restore = installMockInference(
      createMockInference({ kind: "normal", deltas: ["x"] }),
    );
    expect(resolveRequest("promptApi")).toMatchObject({
      tools: "none",
      substituted: "ipa",
    });

    restore();
    restore = installMockInference(undefined);
    restorePromptApi();
    restorePromptApi = installMockPromptApi(createMockPromptApi());
    expect(resolveRequest("ipa")).toMatchObject({
      onDevice: true,
      substituted: "promptApi",
    });
  });

  it("leaves the default path exactly as it was", () => {
    restorePromptApi = installMockPromptApi(createMockPromptApi());
    restore = installMockInference(
      createMockInference({ kind: "normal" }, { toolCalling: true }),
    );
    expect(resolveRequest("auto")).toMatchObject({ tools: "standard" });
    expect(resolveRequest("auto").substituted).toBeUndefined();
    expect(resolveRequest("ipa")).toMatchObject({ tools: "standard" });
    expect(resolveRequest("ipa").substituted).toBeUndefined();
  });

  it("lists both backends with what each can do", async () => {
    restorePromptApi = installMockPromptApi(
      createMockPromptApi({ availability: "downloadable" }),
    );
    restore = installMockInference(
      createMockInference({ kind: "normal" }, { toolCalling: true }),
    );

    const backends = await listBackends();
    expect(backends.map((backend) => backend.id)).toEqual(["ipa", "promptApi"]);
    expect(backends[0]).toMatchObject({
      availability: "available",
      capabilities: { tools: "standard", images: false },
    });
    // Downloadable is not unavailable: a menu has to say so before the click
    // that starts the download.
    expect(backends[1]).toMatchObject({
      availability: "downloadable",
      capabilities: { tools: "none", images: false },
    });
    // A backend is never a provider or a model name.
    for (const backend of backends) {
      expect(backend.label).not.toMatch(/gpt|claude|gemini|llama/i);
    }
  });
});
