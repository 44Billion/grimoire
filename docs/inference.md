# Inference (the `ai` window)

grimoire asks a model without ever holding a key. Inference comes from the
[Inference Provider API](https://github.com/SamSamskies/inference-provider-api)
— `window.inference`, injected by an extension the user installs and grants per
origin — or, when no extension is present, from Chrome's own on-device model.
The page never sees a key, never names a provider, and never chooses a model.

## The pieces

| File | What it owns |
| --- | --- |
| `src/services/inference.ts` | Lookup, error helpers, `resolveRequest()`, the fallback client, `probeInference()` |
| `src/services/prompt-api.ts` | Chrome's Prompt API as an `ipa-tools` fallback backend |
| `src/services/tool-loop.ts` | The page-side multi-round tool loop |
| `src/lib/ai-tools.ts` | The three tools and their executors |
| `src/lib/ai-filter.ts` | A model's arguments as a NIP-01 filter, aliases resolved |
| `src/lib/ai-context.ts` | The system prompt, built from what grimoire already holds |
| `src/components/AiViewer.tsx` | The window: turns, streaming, persistence |
| `src/types/inference.ts` | `ipa-tools` types, aliased, plus the experimental namespace |

Types and error helpers come from `ipa-tools`; nothing here re-implements the
spec. `parseToolArguments` is the one exception, and says why inline.

## Rules that are not obvious

**Match on `code`, never `instanceof`.** An injector reconstructs an error
across isolated worlds, so the prototype is gone by the time the page sees it.
`isInferenceError` checks for a spec `code` string.

**`window.inference` is non-configurable.** A page cannot replace it, so runtime
mocking is impossible: tests inject below the module boundary
(`src/test/mock-inference.ts`) or stub the global before import.

**Tool calling rides `window.inference.experimental` today.** Inference Bridge
reports `getFeatures().toolCalling === false` and offers tools on its own
namespace anyway. `resolveRequest()` prefers the spec surface, falls back to the
experimental one only to gain tools, and reports which is in use as
`ToolSupport`. The spec asks applications not to depend on injector namespaces —
so if that surface changes, tool calling stops and the fenced-command path takes
over. Nothing else breaks.

**IPA is decided in `resolveRequest()`, not by the client.** `ipa-tools`'
`createInference({ fallbacks })` re-checks the injector around every probe and
create, which is why a late injection still wins — but it only knows `request`.
Routing an injected provider through it would silently drop tool calling. So:
injector first, decided here; no injector, the client.

**`done.model` is the extension's choice.** Show it, never pick it. The
on-device fallback reports `chrome/on-device`, because Chrome does not name its
model and neither should we.

**The on-device model downloads on first use**, which needs a user gesture. That
is why `ai "prompt"` prefills instead of auto-sending when there is no injector,
and why progress is surfaced — a silent multi-hundred-megabyte wait is the hang
class this repo keeps shipping.

**Chrome has shipped `promptStreaming` chunks both ways** — deltas and
whole-answer-so-far — with nothing in the API to distinguish them. The adapter
diffs each chunk against what it already emitted, so both render once.

## The tool loop

IPA relays tool calls; it is explicitly not an agent runtime, so the loop is
ours (`runToolLoop`). Four rounds maximum. Per round it reports `ToolRun`
snapshots and stamps each run with its round, so the UI can show the reasoning
that led to a call above it and the reasoning that followed below.

- `onDelta` and `onReasoningDelta` emit **snapshots, not deltas**. The loop drops
  the preamble a tool-calling round emits, so a caller that appended deltas
  itself would render text the settled turn does not contain.
- Reasoning is kept **per round**. A `done` chunk carries the whole round's
  reasoning, so assigning it erases what earlier rounds thought — which is
  exactly the part that explains a tool call.
- A failing tool becomes an `output-error` run **and** an error result fed back
  to the model. A turn does not die because one relay did.

## The tools

Deliberately few: IPA's permission UI lists every function name and re-prompts
whenever the set widens, so a large surface costs the user a dialog full of names
and a fresh prompt every time it grows.

- **`lookup_spec`** — a NIP's text, a kind's definition, or a command's manual
  page, from grimoire's own registry and cache. The command name is an enum of
  the commands Hex may also propose; `post`, `zap` and `wallet` are absent from
  both.
- **`list_spells`** — the user's saved spells, as alias plus the `req` each one
  runs, so Hex can open one with `open_window` or run its filter through
  `query_nostr` rather than guessing what a spell does. Local rows only; nothing
  here saves, publishes or deletes. Its own tool rather than a parameter on
  `lookup_spec`, which is documentation — and not in the system prompt, which
  would pay for the list on every turn to use it on few.
- **`query_nostr`** — a full NIP-01 filter (`ids`, `authors`, `kinds`, `since`,
  `until`, `search`, single-letter tags via a `tags` object), `$me` and
  `$contacts` expanded page-side. Returns at most 20 events with content
  truncated, plus the `npub` and `nevent` to quote: handed only hex, a model
  invents bech32 with a bad checksum, and an undecodable reference renders as
  dead text.
- **`resolve`** (`src/lib/resolve-entity.ts`) — a bech32 entity as the thing it
  names: the kind 0 for a person, the event for a note/nevent/naddr, EventStore
  first and relays second. Without it a model that meets an entity in a tag or a
  question can only repeat it, since bech32 is not readable by inspection.
- **`open_window`** — runs a read-only grimoire command. `post`, `zap` and
  `wallet` are refused and must be proposed for the user to click.

None of them sign, publish, spend or follow. Tool arguments are shaped by
whatever the model read — including note text, which is untrusted — so the only
writes available are windows the user then drives themselves.

## Grounding

The point of asking a model inside a Nostr explorer is that the object is already
resident: in the EventStore, in the kind registry, in the cached NIP text. No
retrieval layer, no embeddings — name the thing and its own data goes in the
prompt (`buildAiContext`). `buildMentionContext` does the same for up to three
`nostr:` references in a question.

`ai` takes an event, a profile, a kind or a NIP as its subject, and every one of
those has an entry point in the UI (the event menu, the profile header, the kind
and NIP windows) through `AskHexButton`.

The composer is `RichEditor`, the same editor the chat and post windows use: `@`
completes to a profile and a pasted entity becomes a preview. What it serializes
is `nostr:` URIs, which is exactly what `buildMentionContext` resolves and what
the reply renderer links — so a mention is a mention all the way through.

## Testing

`src/test/mock-inference.ts` and `src/test/mock-prompt-api.ts` serve the
behaviours that break a client: a stream that ends without `done`, an error
reconstructed as a plain object, an abort mid-stream, a provider that repeats its
reasoning in `done`, a cumulative chunk stream, a model that is downloadable
rather than ready. Anything reproducible through them belongs in a test rather
than in a live request — a live request costs the user money.

What tests cannot cover: whether an injector is installed, and whether Chrome's
real stream behaves as documented. Drive the app for those.
