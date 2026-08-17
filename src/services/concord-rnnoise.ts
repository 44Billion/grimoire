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
  });
  return wasmBinary;
}

class RnnoiseTrackProcessor implements AudioTrackProcessor {
  name = PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;

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

  /** Re-wire for a replacement track. Torn down first, or graphs stack up. */
  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.teardown();
    await this.setup(opts);
  }

  async destroy(): Promise<void> {
    await this.teardown();
  }

  private async setup(opts: AudioProcessorOptions): Promise<void> {
    const audioContext = opts.audioContext;
    if (!audioContext) throw new Error("rnnoise: no AudioContext");

    let modulePromise = RnnoiseTrackProcessor.moduleByContext.get(audioContext);
    if (!modulePromise) {
      modulePromise = audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
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
    try {
      this.source?.disconnect();
      this.rnnoise?.disconnect();
      this.destination?.disconnect();
      this.rnnoise?.destroy();
    } catch {
      // Best-effort: a half-built graph must not block a call from ending.
    }
    this.source = undefined;
    this.rnnoise = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
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
