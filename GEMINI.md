# GEMINI.md

This file provides context and guidance for Gemini (and other AI agents) when working with the Grimoire repository.

## Project Overview

Grimoire is a Nostr protocol explorer and developer tool. It features a tiling window manager interface where each window is a Nostr "app" (profile viewer, event feed, NIP documentation, etc.). Commands are launched Unix-style via a `Cmd+K` palette.

**Stack:** React 19 + TypeScript + Vite + TailwindCSS + Jotai + Dexie + Applesauce

## Core Architecture

### 1. Dual State System

*   **UI State** (`src/core/state.ts` + `src/core/logic.ts`):
    *   Managed by **Jotai** atoms, persisted to `localStorage`.
    *   **Mutations:** strict adherence to pure functions in `src/core/logic.ts` (`(state, payload) => newState`).
    *   **Scope:** Workspaces, windows, layout tree, active account.

*   **Nostr State** (`src/services/event-store.ts`):
    *   **Singleton `EventStore`** from `applesauce-core`.
    *   Single source of truth for all Nostr events.
    *   Reactive: Components subscribe via hooks (`useProfile`, `useTimeline`, `useNostrEvent`).
    *   **CRITICAL:** Do NOT create new `EventStore` instances. Use the singleton in `src/services/`.

*   **Relay State** (`src/services/relay-liveness.ts`):
    *   Singleton `RelayLiveness` tracks relay health.
    *   Persisted to Dexie.

### 2. Window System

*   **Layout:** Recursive binary split layout via `react-mosaic-component`.
*   **Structure:**
    *   **Leaf:** Window ID (UUID).
    *   **Branch:** Split space.
*   **Constraint:** **Never manipulate the layout tree directly.** Use `updateLayout()` callbacks or `logic.ts` helpers.
*   **Window Props:** `id`, `appId` (type identifier), `title`, `props`.

### 3. Command System

*   **Definition:** `src/types/man.ts` defines commands as Unix man pages.
*   **Flow:** User types command -> `argParser` resolves props -> Helper opens specific `appId` viewer.
*   **Global Flags:** Defined in `src/lib/global-flags.ts` (e.g., `--title` overrides window title).

### 4. Reactive Nostr Pattern

*   **Flow:** Relays -> EventStore -> Observables -> Component Hooks.
*   **Helpers:** Use `applesauce-react` hooks or custom hooks in `src/hooks/`.
*   **Replaceable Events:** Handled automatically by EventStore (kinds 0, 3, 10000+, 30000+).

## Key Conventions

*   **Path Alias:** `@/` maps to `./src/`.
*   **Styling:** TailwindCSS + HSL variables for theming (defined in `index.css`).
*   **Organization:** Domain-based (`nostr/`, `ui/`, `services/`, `hooks/`, `lib/`).
*   **Types:** Prefer `applesauce-core` types; extend in `src/types/`.

## Important Patterns

### Adding New Commands
1.  Add entry to `manPages` in `src/types/man.ts`.
2.  Create argument parser in `src/lib/*-parser.ts`.
3.  Create viewer component for the `appId`.
4.  Register viewer in `WindowTitle.tsx` (or equivalent registry).

### Event Rendering
*   **Pattern:** Registry-based rendering.
*   **Files:** `src/components/nostr/kinds/index.tsx`.
*   **Components:** `KindRenderer` (feed) and `DetailKindRenderer` (detail/full view).
*   **Naming:** Use descriptive names (`LiveActivityRenderer`) not numbers (`Kind30311Renderer`).
*   **Safety:** All renderers are wrapped in `EventErrorBoundary`.

### Testing
*   **Framework:** Vitest.
*   **Commands:**
    *   `npm test`: Watch mode.
    *   `npm run test:run`: CI mode (single run).
*   **Focus:** Test pure functions in `logic.ts`, parsers in `lib/*-parser.ts`, and utilities.

## Critical Rules for Agents

> [!IMPORTANT]
> **Do NOT create new instances of singletons.**
> *   `EventStore`, `RelayPool`, `RelayLiveness` are singletons in `src/services/`.

> [!IMPORTANT]
> **Respect the Layout Tree.**
> *   Do not manually traverse or modify the Mosaic layout object. Use specific update callbacks.

> [!NOTE]
> **Use the Knowledge Base.**
> *   Refer to `CLAUDE.md` for the original documentation source.
> *   Check `.claude/skills` for library-specific documentation (Applesauce, Nostr tools).
