Drive the running app to confirm a change actually works. Use after anything touching relays, dependencies, the React tree, or the service worker — `npm run lint && npm run typecheck && npm run test:run && npm run build` passing does **not** mean the app runs.

## Start the dev server

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill   # free the port first
nohup npm run dev > /tmp/grimoire-dev.log 2>&1 &
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173
```

Vite 8 (rolldown) builds in well under a second, so a slow start means something is wrong. Clear `node_modules/.vite` after any dependency change — a stale optimizer hash breaks dynamic imports.

## Drive it

Use the `claude-in-chrome` skill. Load the tools in one `ToolSearch` call, `tabs_context_mcp` first, then `navigate` to `http://localhost:5173`.

Check these, in this order — each has caught a real bug:

1. **App boots.** A blank frame means a module-init crash. Read `read_console_messages` with `onlyErrors: true`; tracking starts when the tool is first called, so reload after calling it to catch load-time errors.
2. **A feed reaches a settled state.** `req -k 1 --limit 5` via Cmd+K should reach `LIVE` with `n/n` relays and stream events. Stuck on `LOADING` means EOSE handling is broken.
3. **Chat loads messages.** `chat groups.0xchat.com'NkeVhXuWHGKKJCpn`. NIP-29 is the only enabled protocol, and NIP-29 relays commonly require AUTH.
4. **Routes render.** `/`, `/run?cmd=profile%20fiatjaf.com`, `/note1…`, `/npub1…`, `/:actor/:identifier`, and a bad path (should show the 404 page inside `AppShell`, not react-router's dev screen).
5. **The `ai` window mounts and is grounded.** Bare `ai` is the landing page — greeting, three openers, an autofocused composer, then stored conversations; `ai npub1…` previews the person through the kind 0 renderer; "Ask Hex" on an event opens a window whose embed resolves and is fully visible from the top. Every one of those has broken while the pipeline was green — twice as a crashed component that looked like an event failing to load, so read `read_console_messages` before believing what the pane shows.

   **Do not send** unless the change is in the request path: each turn spends the user's own money through their extension. `ai "prompt"` auto-sends by design, so type into the composer and leave it there instead. When you must send, one turn is enough, and prefer a question that needs a tool (`summarize the last 5 notes from my contacts`) since the tool loop is where the bugs are.

   Tool results render as the thing they returned, headed by the canonical tool id (`nostr.req`, `grimoire.help`): a feed for a query, badges for a lookup, command rows for a suggestion, and a draft card for `nostr.publish` — body, relay list with connection state, and a **Sign & publish** button. Never press that button; publishing is the user's signature, not yours. In a reply, check that `nostr:` references render as people and events and that `NIP-XX` is a link — both are re-linked by hand, since markdown never passes through applesauce's content pipeline.

   Reopen a stored conversation from the index afterwards: the mentions must still render as people and notes, not bech32. They are kept on the turn precisely because the EventStore is memory.

   Anything that opens a window from a `/run` page mutates state invisibly (issue #313), so drive the `ai` window from the app, not from `/run`, when the thing you are checking is a click that opens something.

   To exercise the on-device fallback, disable the Inference Bridge extension first — with an injector present `resolveRequest()` never reaches it — and expect Chrome's model to download on the first send, which needs a real click and shows a progress bar.

## Gotchas that have wasted time here

- **Phone mode.** The device selector in the top bar shrinks each window's content area to ~150px, so messages render *outside* the visible scroll region and the window looks empty. Confirm via the DOM (`document.body.innerText`, `[data-index]` node count) before concluding anything is broken. This once looked like a total regression and was not.
- **Your own instrumentation lies.** Creating adapters or subscriptions from the console adds events, moves scroll positions, and has frozen the renderer. When a result looks alarming, re-check in a clean tab with no injected JS.
- **This is the user's real session** — their accounts, workspaces and persisted layouts. Don't answer NIP-42 auth prompts (that's an authentication decision), and close any windows you open.
- **Compare against `main` before blaming the branch.** `git stash` and reload; an identical result means the cause is environmental.

## Relay edge cases

Don't hunt for a misbehaving relay in the wild — use `src/test/mock-relay.ts`, which serves `normal`, `auth-required`, `silent` and `close-after-eose`. It works from the browser too: start it on a port and pass `ws://localhost:<port>'group` as an identifier (`parseIdentifier` keeps an explicit `ws://`). Anything reproducible this way belongs in `src/lib/relay-subscription.test.ts` instead of being re-verified by hand.
