/**
 * Where inference happens, as a thing the user can see and choose.
 *
 * Two backends today: an extension injecting `window.inference`, and the
 * browser's own on-device model. A backend is **not** a provider and never a
 * model — which company answers and with which weights is the extension's
 * choice, and IPA exists so the page never makes it. What the page may decide is
 * whether the question leaves the machine at all, which is why this is worth a
 * preference: on-device is private and free, and until now it was unreachable
 * for anyone who had an extension installed.
 *
 * `ipa-tools`' resolver is IPA-first by construction and `normalizeFallbacks`
 * refuses `"ipa"` as an entry, so "prefer on-device" cannot be expressed through
 * it. Forcing on-device therefore drives the Prompt API backend directly, and
 * everything else still goes through the client so a late injection wins.
 *
 * Capabilities are derived at call time, never cached: an extension can appear
 * after the window opened, and its `getFeatures()` is the only truth about tools.
 */

import { createInference, type InferenceClient } from "ipa-tools";

import {
  createPromptApiBackend,
  isPromptApiPresent,
  promptApiAvailability,
  PROMPT_API_ID,
} from "./prompt-api";

import type { BackendAvailability, InferenceBackend } from "ipa-tools";
import type { Inference, InferenceFeatures } from "@/types/inference";

/** Id of the injected-extension backend. Stable: it is persisted. */
export const IPA_ID = "ipa";

export { PROMPT_API_ID };

/**
 * Which backend to use, when the user has said. `undefined` means "whatever
 * answers", which is IPA first — the historical behaviour and the default.
 */
export type BackendPreference = typeof IPA_ID | typeof PROMPT_API_ID | "auto";

/**
 * How this window may send tools, if at all.
 *
 * `"standard"` is a spec-advertised capability. `"experimental"` means the
 * injector only offers tools on its own namespace — usable, but a surface the
 * spec asks applications not to depend on, so callers must say so.
 */
export type ToolSupport = "standard" | "experimental" | "none";

export interface BackendCapabilities {
  tools: ToolSupport;
  /**
   * Images in a message. False for both backends today: the IPA draft lists
   * images as out of scope and its `content` is a string, and the Prompt API
   * adapter here is text-only. This is the flag an attachment button waits on
   * rather than a guess about which provider is behind the extension.
   */
  images: boolean;
  /** `InferenceOptions` keys the backend accepts, as it advertises them. */
  options: InferenceFeatures["options"];
}

export interface BackendInfo {
  id: typeof IPA_ID | typeof PROMPT_API_ID;
  /** What it is, not who answers: never a provider or a model name. */
  label: string;
  description: string;
  availability: BackendAvailability;
  capabilities: BackendCapabilities;
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
 * IPA first, on-device second. One client for the app: it caches the resolved
 * backend, and the on-device model is a download nobody wants twice.
 */
let client: InferenceClient | undefined;

export function fallbackClient(): InferenceClient {
  client ??= createInference({
    fallbacks: [promptApiBackend()],
    onDownloadProgress: (loaded) => downloadProgress?.(loaded),
  });
  return client;
}

/** One backend object, so one model session is opened however it is reached. */
let promptApi: InferenceBackend | undefined;

function promptApiBackend(): InferenceBackend {
  promptApi ??= createPromptApiBackend();
  return promptApi;
}

/**
 * The on-device model, driven directly.
 *
 * Only for a user who asked for it: `create()` starts the download, so this is
 * called from a send, never from a probe.
 */
export async function onDeviceInference(
  signal?: AbortSignal,
): Promise<Inference> {
  return (await promptApiBackend().create({
    onDownloadProgress: (loaded) => downloadProgress?.(loaded),
    ...(signal ? { signal } : {}),
  })) as Inference;
}

/** True when the on-device model exists in this browser at all. */
export { isPromptApiPresent, promptApiAvailability };

/** Tool support the injector offers, and by which surface. */
export function ipaToolSupport(inference: Inference): ToolSupport {
  if (inference.getFeatures?.().toolCalling === true) return "standard";
  return typeof inference.experimental?.request === "function"
    ? "experimental"
    : "none";
}

/**
 * Both backends with their current state, for a selector.
 *
 * Asynchronous because the on-device model reports four states, one of which is
 * a download that has not happened yet — a menu has to say so before the click
 * that starts it.
 */
export async function describeBackends(
  inference: Inference | undefined,
): Promise<BackendInfo[]> {
  const features = inference?.getFeatures?.() ?? {};
  const onDevice = await promptApiAvailability();

  return [
    {
      id: IPA_ID,
      label: "Extension",
      description:
        "Your extension picks the provider and model, and pays for the request.",
      availability: inference ? "available" : "unavailable",
      capabilities: {
        tools: inference ? ipaToolSupport(inference) : "none",
        images: false,
        options: features.options,
      },
    },
    {
      id: PROMPT_API_ID,
      label: "On-device",
      description:
        "The browser's own model. Nothing leaves the machine, and nothing is charged.",
      availability: onDevice,
      capabilities: { tools: "none", images: false, options: {} },
    },
  ];
}
