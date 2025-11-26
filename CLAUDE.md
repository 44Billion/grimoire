# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Grimoire** is a Nostr client built with React, TypeScript, Vite, and TailwindCSS. It connects to Nostr relays to fetch and display events (notes) with rich text formatting and user profile integration.

## Technology Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite 6
- **Styling**: TailwindCSS 3 with shadcn/ui design system (New York style)
- **Routing**: React Router 7
- **Nostr Integration**: Applesauce library suite
  - `applesauce-relay`: Relay connection and event subscription
  - `applesauce-core`: Event storage and deduplication
  - `applesauce-react`: React hooks for content rendering
  - `applesauce-content`: Content parsing utilities
- **State Management**: RxJS Observables for reactive event streams
- **Icons**: Lucide React

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Preview production build
npm run preview
```

## Architecture

### Service Layer (Idiomatic Applesauce)

Simple singleton exports for global instances:

**`src/services/event-store.ts`** - Global EventStore instance
- Centralized event cache and deduplication
- Accessed via `useEventStore()` hook in components

**`src/services/relay-pool.ts`** - Global RelayPool instance
- Manages WebSocket connections to Nostr relays
- Used by loaders for event fetching

**`src/services/loaders.ts`** - Pre-configured loaders
- `eventLoader` - Fetches single events by ID
- `addressLoader` - Fetches replaceable events (kind:pubkey:d-tag)
- `profileLoader` - Fetches profiles with 200ms batching
- `createTimelineLoader` - Factory for creating timeline loaders
- Uses `AGGREGATOR_RELAYS` for better event discovery

### Provider Setup

**EventStoreProvider** (`src/main.tsx`) - Wraps app to provide EventStore via React context
- All components access store through `useEventStore()` hook
- Enables reactive updates when events are added to store

### Loader Pattern (Efficient Data Fetching)

Loaders from `applesauce-loaders` provide:
- **Automatic batching**: Multiple profile requests within 200ms window combined into single relay query
- **Smart relay selection**: Uses event hints, relay lists, and aggregator relays
- **Deduplication**: Won't refetch events already in store
- **Observable streams**: Returns RxJS observables for reactive updates

### React Hooks Pattern (Observable-Based)

Three primary custom hooks provide reactive Nostr data:

**`useTimeline(id, filters, relays, options)`** - Subscribe to event timeline
- Returns: `{ events, loading, error }`
- Uses `createTimelineLoader` for efficient batch loading
- Watches EventStore with `useObservableMemo` for reactive updates
- Auto-sorts by `created_at` descending

**`useProfile(pubkey)`** - Fetch user profile metadata (kind 0)
- Returns: `ProfileMetadata | undefined`
- Uses `profileLoader` with automatic batching
- Subscribes to `ProfileModel` in EventStore for reactive updates

**`useNostrEvent(eventId, relayUrl?)`** - Fetch single event by ID
- Returns: `NostrEvent | undefined`
- Uses `eventLoader` for efficient caching
- Watches EventStore for event arrival

### Component Architecture

**Nostr Components** (`src/components/nostr/`)
- **`UserName`**: Displays user's display name with fallback to pubkey snippet
- **`RichText`**: Renders Nostr event content with rich formatting
  - Uses `applesauce-react`'s `useRenderedContent` hook
  - Supports: mentions (@npub), hashtags, links, images, videos, emojis, quotes
  - Custom content node renderers in `contentComponents` object

**Main Components** (`src/components/`)
- **`Home`**: Main feed component displaying recent notes

### Type System

**Core Types** (`src/types/`)
- `NostrEvent`: Standard Nostr event structure (id, pubkey, created_at, kind, tags, content, sig)
- `NostrFilter`: Relay query filters (ids, authors, kinds, since, until, limit)
- `ProfileMetadata`: User profile fields (name, display_name, about, picture, etc.)

### Utility Functions

**`src/lib/nostr-utils.ts`**
- `derivePlaceholderName(pubkey)`: Creates `"xxxxxxxx..."` placeholder from pubkey
- `getDisplayName(metadata, pubkey)`: Priority logic: display_name → name → placeholder

**`src/lib/utils.ts`**
- `cn()`: TailwindCSS class merger using `clsx` and `tailwind-merge`

## Path Aliases

All imports use `@/` prefix for `src/` directory:
```typescript
import { nostrService } from '@/services/nostr'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'
```

## Environment Configuration

`.env` file should contain:
```
VITE_NOSTR_RELAY=wss://theforest.nostr1.com
```

Access via: `import.meta.env.VITE_NOSTR_RELAY`

## Styling System

- **Dark Mode**: Default theme with `dark` class on `<html>` element
- **Design System**: shadcn/ui (New York variant) with HSL CSS variables
- **Color Palette**: Semantic tokens (background, foreground, primary, secondary, muted, accent, destructive)
- **Font**: Oxygen Mono for monospace text
- **Utilities**: Use `cn()` helper for conditional classes

## Key Patterns

1. **Global EventStore**: Single source of truth for all events, accessed via `useEventStore()` hook
2. **Loader-Based Fetching**: Use loaders instead of direct subscriptions for automatic batching and caching
3. **Observable Reactivity**: Use `useObservableMemo()` to watch EventStore and auto-update on changes
4. **Automatic Batching**: Profile and event requests batched within 200ms window
5. **Event Deduplication**: Handled automatically by EventStore, no manual checks needed
6. **Fallback UI**: Show placeholders for missing profile data, handle loading/error states
7. **Rich Content Rendering**: Delegate to `applesauce-react` for Nostr content parsing

## Important Notes

- All components must be wrapped in `EventStoreProvider` to access the store
- Loaders automatically handle subscription cleanup, but always unsubscribe in `useEffect` cleanup
- EventStore provides reactive queries: `.event(id)`, `.replaceable(kind, pubkey, d)`, `.timeline(filters)`
- Profile requests are batched - multiple `useProfile` calls within 200ms become single relay query
- The RichText component requires the full event object, not just content string
- Use `useObservableMemo()` for reactive store queries, not `useState` + subscriptions
