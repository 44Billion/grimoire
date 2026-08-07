Spawn an adversarial reviewer subagent for the current branch or a named PR.

Target: `$ARGUMENTS` (a PR number, a branch, or empty for the current branch vs `main`).

This project's recurring failure mode is **silent regressions that lint, typecheck, tests and the build all miss** — a duplicate React that crashed at module init, chat rendering nothing, timelines hung in LOADING, a one-shot request that never settled, a 42,000-REQ-per-second flood. Reviews here exist to catch that class, not to comment on style.

## Spawn one agent with a prompt built from this shape

Fill in the specifics for the change under review, then keep every section below.

**Framing.** "You are an adversarial reviewer. Your goal is to BREAK this code and find real defects. Assume the author was overconfident. Do not praise; do not summarise the design back. Findings only."

**Context.** Point at the diff (`git diff main...HEAD`), tell it to read `.claude/commands/review.md` and `CLAUDE.md` first, and say that the installed library code under `node_modules` is ground truth over any documentation.

**The bar.** A finding must name a concrete user-visible failure and meet at least one of:

- Data loss or corruption — especially signed Nostr events published to relays, or persisted state (localStorage, IndexedDB, spellbook content)
- A hang, infinite loop, unbounded growth, or request flood
- A crash, or a module that fails to load
- A silent behavioural regression versus `main` that types and tests cannot catch — weight this heavily
- Something needing a hotfix within a day of merging

**Permission to find nothing.** State plainly: "Returning zero findings is a valid and welcome result. Padding with minor observations wastes the reader's time — a short 'nothing blocking' answer is worth more than a long list of nitpicks."

**Exclusions.** List them explicitly or the agent will re-litigate settled decisions:

- Anything already tracked as an open issue — give the numbers, and tell it to check with `gh issue view <n>` if unsure
- Style, naming, comment wording, formatting, file organisation
- The lint warnings pinned to `warn` in `eslint.config.js` — that decision is made
- Missing test coverage as a category
- Pre-existing bugs the change didn't touch, unless it makes them materially worse
- Refactors that would merely be "cleaner"

**Already covered.** Summarise what previous passes verified, so it doesn't re-derive.

**Where to look.** Name the files the change touched most, anything edited across several commits (check it reads coherently and no edit undid another), and the persistence/wire-format boundaries.

**Output.** Verdict first (`MERGE` / `DON'T MERGE` + reason), then at most 5 findings ranked by severity, each with `file:line`, a concrete failure scenario, and whether it traced the claim or is inferring.

**Verify-before-asserting.** Say this: "Both prior reviewers misattributed something they were confident about — particularly claims about what `main` did. Verify before asserting."

**Rules.** Read-only; no edits, commits or pushes. A dev server may already be on 5173 — don't start another. It may run git, grep, `npm run lint/test:run/build`, and node against `node_modules`.

## After it reports

Verify significant claims yourself before acting — reviewers here have been right about the defect and wrong about its provenance. `git show main:<file>` settles most of it. When a finding is real, prefer encoding the invariant as a lint rule or a test in `src/lib/relay-subscription.test.ts` over documenting it, and use `src/test/mock-relay.ts` for relay behaviours that are hard to reproduce.
