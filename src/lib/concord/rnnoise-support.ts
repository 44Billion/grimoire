/**
 * Whether RNNoise can run here.
 *
 * Two requirements: an AudioWorklet, and a CSP that permits compiling
 * WebAssembly (`wasm-unsafe-eval` or `unsafe-eval` in `script-src`).
 *
 * The CSP probe is the load-bearing half, and it is not paranoia. RNNoise's
 * WASM instantiates ASYNCHRONOUSLY, inside the worklet: the main-thread setup
 * succeeds, LiveKit swaps the published microphone over to the worklet's
 * output, and only then does the blocked instantiation fail — leaving a live
 * call publishing silence with nothing logged anywhere. Compiling a
 * minimal module here (a worklet inherits the document's CSP) is what lets the
 * caller keep the raw track instead.
 *
 * Dependency-free on purpose, so a settings pane can ask the question without
 * pulling in `livekit-client`.
 */

let wasmCompileAllowed: boolean | undefined;

function wasmSupported(): boolean {
  if (wasmCompileAllowed === undefined) {
    try {
      // The smallest valid module — magic bytes and a version. Throws a
      // CompileError where the CSP forbids compilation.
      new WebAssembly.Module(
        new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      );
      wasmCompileAllowed = true;
    } catch {
      wasmCompileAllowed = false;
    }
  }
  return wasmCompileAllowed;
}

export function rnnoiseSupported(): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof window !== "undefined" &&
    typeof window.AudioContext !== "undefined" &&
    wasmSupported()
  );
}
