/**
 * Noise suppression on the microphone, as a LiveKit audio track processor.
 *
 * Ported from armada `src/lib/voiceProcessor.ts`. Xiph's RNNoise (BSD) compiled
 * to WASM, running in an AudioWorklet over the locally captured microphone; the
 * cleaned track is what gets published. Deliberately NOT
 * `@livekit/krisp-noise-filter`, which is proprietary and gated behind LiveKit's
 * commercial terms — unusable in a client anyone can self-host.
 *
 * It runs entirely before encryption, on the raw capture, so it changes nothing
 * about CORD-07: the SFU and the broker still see only ciphertext, and no
 * other member can tell whether it is on.
 *
 * LiveKit drives the lifecycle. `init` receives the raw track and an
 * `AudioContext`, builds source → worklet → destination, and exposes
 * `processedTrack` for LiveKit to publish in place of the original; `restart`
 * rebuilds it for a replacement track (a device switch); `destroy` tears it
 * down. RNNoise assumes 48 kHz, which is what LiveKit's capture context runs at.
 */

import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { LocalAudioTrack } from "livekit-client";

import { rnnoiseSupported } from "@/lib/concord/rnnoise-support";

export { rnnoiseSupported };

/**
 * LiveKit's `TrackProcessor` types sit behind a deep path its `exports` map does
 * not expose, so the small shapes are restated here. They match
 * `livekit-client/.../track/processor/types`; `setProcessor` accepts anything
 * structurally compatible.
 */
interface AudioProcessorOptions {
  kind: "audio";
  track: MediaStreamTrack;
  audioContext: AudioContext;
}

interface AudioTrackProcessor {
  name: string;
  init: (opts: AudioProcessorOptions) => Promise<void>;
  restart: (opts: AudioProcessorOptions) => Promise<void>;
  destroy: () => Promise<void>;
  processedTrack?: MediaStreamTrack;
}

const PROCESSOR_NAME = "rnnoise-noise-suppression";

/** The compiled binary, fetched once and reused. SIMD where available. */
let wasmBinary: Promise<ArrayBuffer> | undefined;

function getWasmBinary(): Promise<ArrayBuffer> {
  wasmBinary ??= loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  }).catch((error: unknown) => {
    // Forget a failure, or one bad fetch disables suppression for the whole
    // session: a cached rejected promise answers every later attempt without
    // retrying. The next call gets to try again.
    wasmBinary = undefined;
    throw error;
  });
  return wasmBinary;
}

class RnnoiseTrackProcessor implements AudioTrackProcessor {
  name = PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;

  /**
   * The context `init` was given.
   *
   * LiveKit passes an `audioContext` on `init` but NOT on the restart it issues
   * from `setMediaStreamTrack` — which is what a device switch, an unmute after
   * one, and a mobile foreground all go through. Reading only `opts` there
   * throws, and the throw escapes before `sender.replaceTrack`, leaving the
   * sender bound to a destination whose graph was just torn down: a live,
   * encrypted, permanently silent microphone, with the error swallowed.
   */
  private audioContext?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private rnnoise?: RnnoiseWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;
  /** The worklet module is registered once per AudioContext, not per track. */
  private static moduleByContext = new WeakMap<
    BaseAudioContext,
    Promise<void>
  >();

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.setup(opts);
  }

  /**
   * Re-wire for a replacement track.
   *
   * The new graph is built BEFORE the old one is dropped, so a setup that
   * throws leaves the previous — working — track in place rather than a
   * disconnected one nobody can hear.
   */
  async restart(opts: AudioProcessorOptions): Promise<void> {
    const previous = {
      source: this.source,
      rnnoise: this.rnnoise,
      destination: this.destination,
    };
    await this.setup(opts);
    disconnect(previous);
  }

  async destroy(): Promise<void> {
    await this.teardown();
  }

  private async setup(opts: AudioProcessorOptions): Promise<void> {
    const audioContext = opts.audioContext ?? this.audioContext;
    if (!audioContext) throw new Error("rnnoise: no AudioContext");
    this.audioContext = audioContext;

    let modulePromise = RnnoiseTrackProcessor.moduleByContext.get(audioContext);
    if (!modulePromise) {
      modulePromise = audioContext.audioWorklet
        .addModule(rnnoiseWorkletUrl)
        .catch((error: unknown) => {
          // Same reason as the WASM above: a cached rejection would answer
          // every later attempt on this context — which lives as long as the
          // room does — so one failed load would disable suppression for the
          // whole call rather than for one attempt.
          RnnoiseTrackProcessor.moduleByContext.delete(audioContext);
          throw error;
        });
      RnnoiseTrackProcessor.moduleByContext.set(audioContext, modulePromise);
    }
    await modulePromise;

    const binary = await getWasmBinary();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([opts.track]),
    );
    const rnnoise = new RnnoiseWorkletNode(audioContext, {
      maxChannels: 1,
      wasmBinary: binary,
    });
    const destination = audioContext.createMediaStreamDestination();

    source.connect(rnnoise);
    rnnoise.connect(destination);

    this.source = source;
    this.rnnoise = rnnoise;
    this.destination = destination;
    this.processedTrack = destination.stream.getAudioTracks()[0];
  }

  private async teardown(): Promise<void> {
    disconnect({
      source: this.source,
      rnnoise: this.rnnoise,
      destination: this.destination,
    });
    this.source = undefined;
    this.rnnoise = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
    this.audioContext = undefined;
  }
}

/** Drop one graph's nodes. Best-effort: a half-built one must not block a call. */
function disconnect(graph: {
  source?: MediaStreamAudioSourceNode;
  rnnoise?: RnnoiseWorkletNode;
  destination?: MediaStreamAudioDestinationNode;
}): void {
  try {
    graph.source?.disconnect();
    graph.rnnoise?.disconnect();
    graph.destination?.disconnect();
    graph.rnnoise?.destroy();
  } catch {
    // Already gone.
  }
}

/**
 * Make a published microphone match `enabled`.
 *
 * Idempotent, and it never throws: a worklet that will not load costs the
 * suppression, never the call — the raw track keeps publishing.
 */
export async function syncRnnoise(
  track: LocalAudioTrack | undefined,
  enabled: boolean,
): Promise<void> {
  if (!(track instanceof LocalAudioTrack)) return;
  const hasOurs = track.getProcessor()?.name === PROCESSOR_NAME;

  if (enabled && !hasOurs && rnnoiseSupported()) {
    try {
      // Cast: the structural shape matches LiveKit's `TrackProcessor`, but its
      // (unexported) generic uses the Track.Kind enum where this uses the
      // "audio" literal, so TS cannot see them as the same type.
      await track.setProcessor(
        new RnnoiseTrackProcessor() as unknown as Parameters<
          LocalAudioTrack["setProcessor"]
        >[0],
      );
    } catch (error) {
      console.warn("[concord] noise suppression could not start:", error);
    }
  } else if (!enabled && hasOurs) {
    try {
      await track.stopProcessor();
    } catch (error) {
      console.warn("[concord] noise suppression could not stop:", error);
    }
  }
}
