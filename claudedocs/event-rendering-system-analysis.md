# Event Rendering System - Comprehensive Analysis & Improvement Plan

**Date**: 2025-12-11
**Context**: Grimoire Nostr Protocol Explorer
**Scope**: Deep architectural analysis of event rendering system covering 150+ registered event kinds with ~20 custom renderers

---

## Executive Summary

The current event rendering system has a **solid foundation** with good architectural patterns (registry-based routing, component reuse, type safety), but suffers from **inconsistencies in application** and **missing abstractions** that limit scalability, maintainability, and extensibility.

**Key Findings:**
- ✅ **Strengths**: Registry pattern, BaseEventContainer, applesauce integration, type safety
- ❌ **Critical Issues**: Hardcoded detail renderers, inconsistent depth tracking, no error boundaries, missing threading abstraction
- 🎯 **Opportunity**: Transform from "working prototype" to "production-grade framework" with systematic improvements

---

## Part 1: Current State Analysis

### Architecture Overview

```
Current System Layers:
┌─────────────────────────────────────┐
│   Renderer Layer                    │  Kind1Renderer, Kind6Renderer, etc.
│   (~20 custom, 130+ using default)  │
├─────────────────────────────────────┤
│   Component Layer                   │  BaseEventContainer, EventAuthor, EventMenu
│   (Reusable UI components)          │  RichText, EmbeddedEvent, MediaEmbed
├─────────────────────────────────────┤
│   Registry Layer                    │  kindRenderers map, KindRenderer router
│   (Routing & fallback)              │  DefaultKindRenderer
├─────────────────────────────────────┤
│   Data Layer                        │  EventStore (applesauce), useNostrEvent hook
│   (Reactive state)                  │  RelayPool, Dexie cache
└─────────────────────────────────────┘
```

### Event Kind Categories

Analysis of 150+ registered kinds reveals **7 fundamental patterns**:

1. **Content-Primary** (1, 30023, 9802)
   - Main payload in `content` field
   - Rich text rendering, markdown, media embeds
   - Examples: Notes, articles, highlights

2. **Reference Events** (6, 7, 9735)
   - Point to other events via e/a tags
   - Embed referenced content
   - Examples: Reposts, reactions, zaps

3. **Metadata Events** (0, 3, 10002)
   - Structured data in content JSON
   - Key-value pairs, lists, configurations
   - Examples: Profiles, contacts, relay lists

4. **List Events** (30000-39999 replaceable)
   - Arrays of items in tags
   - Follow sets, mute lists, bookmarks
   - Addressable/replaceable nature

5. **Media Events** (20, 21, 22, 1063)
   - Content is URLs with metadata
   - Images, videos, files
   - Thumbnails, dimensions, MIME types

6. **Action Events** (5, 1984)
   - Represent operations on other events
   - Deletions, reports, moderation
   - Usually invisible to end users

7. **Communication Events** (4, 14, 1111)
   - Threaded messaging
   - DMs, comments, chat messages
   - Multiple threading models (NIP-10, NIP-22, NIP-28)

---

## Part 2: What's Common to All Events

### Universal Requirements

Every event, regardless of kind, needs:

1. **Author Context** - WHO created this
   - Profile info (name, avatar, NIP-05)
   - Clickable to open profile
   - Badge/verification indicators

2. **Temporal Context** - WHEN was this created
   - Relative timestamps ("2h ago")
   - Absolute time on hover (ISO format)
   - Locale-aware formatting

3. **Event Identity** - WHAT is this
   - Kind badge with icon and name
   - Event ID (bech32 format: nevent/naddr)
   - Copy/share capabilities

4. **Actions** - User operations
   - Open in detail view
   - Copy event ID
   - View raw JSON
   - (Future: Reply, React, Zap, Share)

5. **Relay Context** - WHERE was this seen
   - List of relays that served the event
   - Relay health indicators
   - Relay preferences for publishing

6. **Addressability** - HOW to reference
   - Regular events: nevent (id + relays + author)
   - Addressable events: naddr (kind + pubkey + identifier + relays)
   - note1 (deprecated but still supported)

### Current Implementation

**Well-Handled:**
- ✅ Author, Temporal, Identity, Actions (1-4) via `BaseEventContainer` + `EventMenu`
- ✅ Addressability (6) logic in EventDetailViewer

**Missing Universally:**
- ❌ Signature verification indicator
- ❌ Edit history (NIP-09 deletion event tracking)
- ❌ Engagement preview (reply count, zap total, reaction summary)
- ❌ Related events indicator
- ❌ Community/context badges (NIP-72 communities, NIP-29 groups)

**Recommendation:** Extend `BaseEventContainer` with optional engagement footer and verification indicator.

---

## Part 3: Rendering Context Analysis

### Three Primary Contexts

1. **Feed/Timeline** - Compact, scannable view
   - Emphasis on density, quick scanning
   - Show summary/preview, not full content
   - Inline media thumbnails
   - Minimal interaction chrome

2. **Detail** - Expansive, full-content view
   - Emphasis on readability, completeness
   - Full markdown rendering, full-size media
   - Show relationships (replies, zaps, reactions)
   - Additional metadata and actions

3. **Embedded** - Nested preview within another event
   - Context-aware depth limiting
   - Minimal chrome (no duplicate headers if already in context)
   - Click to expand/navigate
   - Performance-conscious (lazy load)

### Current Implementation

**Feed Rendering:**
- ✅ Works well with `KindRenderer` + `BaseEventContainer`
- ✅ Consistent pattern across all kinds
- ⚠️ No virtualization for performance

**Detail Rendering:**
- ❌ **CRITICAL**: Hardcoded switch statement in `EventDetailViewer.tsx`:
  ```tsx
  event.kind === kinds.Metadata ? <Kind0DetailRenderer />
  : event.kind === kinds.Contacts ? <Kind3DetailView />
  : event.kind === kinds.LongFormArticle ? <Kind30023DetailRenderer />
  : <KindRenderer event={event} />
  ```
- ❌ Breaks registry pattern - not extensible
- ❌ Only 5 kinds have detail renderers, rest fallback to feed

**Embedded Rendering:**
- ⚠️ Uses same as feed (via `EmbeddedEvent` → `KindRenderer`)
- ⚠️ No context awareness
- ⚠️ Depth tracking inconsistent

### Recommended Architecture

**Unified Registry Pattern:**
```tsx
// Proposed structure
export const kindRenderers: KindRendererRegistry = {
  1: {
    feed: Kind1Renderer,
    detail: Kind1DetailRenderer, // optional, fallback to feed
    embed: Kind1EmbedRenderer,   // optional, fallback to feed
  },
  // Or simplified:
  1: Kind1Renderer, // if no variants needed
  30023: {
    feed: Kind30023Renderer,     // Compact: title + summary
    detail: Kind30023DetailRenderer, // Full markdown + relationships
  }
};

// Usage
function KindRenderer({ event, context = 'feed' }) {
  const registry = kindRenderers[event.kind];
  const Renderer = registry?.[context] || registry?.feed || registry || DefaultKindRenderer;
  return <Renderer event={event} context={context} />;
}
```

**Benefits:**
- ✅ Consistent pattern for all contexts
- ✅ Extensible - add detail renderers without modifying router
- ✅ Self-documenting - registry shows available variants
- ✅ Type-safe - validate registry at compile time

---

## Part 4: Depth Tracking & Nesting

### The Problem

Events can reference other events infinitely:
- Kind 6 (repost) of Kind 6 of Kind 6... → infinite loop
- Kind 1 (note) replying to Kind 1 replying to Kind 1... → deep nesting
- Kind 9735 (zap) of article containing zaps... → exponential expansion

### Current State

- ✅ `Kind1Renderer` passes `depth` to `RichText`
- ✅ `RichText` uses depth to limit nesting
- ❌ `Kind6Renderer` (repost) doesn't track depth → infinite loop possible
- ❌ `Kind9735Renderer` (zap) embeds without depth → can nest infinitely
- ❌ `EmbeddedEvent` doesn't auto-increment depth

### Solution: Systematic Depth Management

```tsx
// 1. Universal depth constant
export const MAX_EMBED_DEPTH = 3;

// 2. All renderers receive and honor depth
export interface BaseEventProps {
  event: NostrEvent;
  depth?: number;
  context?: 'feed' | 'detail' | 'embed';
}

// 3. EmbeddedEvent auto-increments
export function EmbeddedEvent({ eventId, depth = 0, ...props }) {
  const event = useNostrEvent(eventId);
  if (!event) return <LoadingState />;

  if (depth >= MAX_EMBED_DEPTH) {
    return <CollapsedPreview event={event} onExpand={...} />;
  }

  return <KindRenderer event={event} depth={depth + 1} />;
}

// 4. Depth-aware rendering
export function Kind6Renderer({ event, depth = 0 }) {
  if (depth >= MAX_EMBED_DEPTH) {
    return <BaseEventContainer event={event}>
      <div>Repost of <EventLink id={...} /></div>
    </BaseEventContainer>;
  }

  return <BaseEventContainer event={event}>
    <div>Reposted</div>
    <EmbeddedEvent eventId={...} depth={depth} />
  </BaseEventContainer>;
}
```

**Benefits:**
- ✅ Prevents infinite loops
- ✅ Improves performance (limits cascade fetching)
- ✅ Better UX (collapsed deep threads with expand option)
- ✅ Consistent behavior across all renderers

---

## Part 5: Threading & Reply Abstraction

### The Challenge

Multiple threading models exist in Nostr:

1. **NIP-10** (Kind 1 notes)
   - `e` tags with markers: `["e", id, relay, "root"|"reply"]`
   - Root = original post, Reply = immediate parent
   - Mentions = other referenced events

2. **NIP-22** (Kind 1111 comments)
   - **Uppercase tags** = root scope: `K`, `E`, `A`, `I`, `P`
   - **Lowercase tags** = parent item: `k`, `e`, `a`, `i`, `p`
   - Can thread on events OR external identifiers (URLs, podcasts, etc.)
   - MUST NOT reply to kind 1 notes (use kind 1 instead)

3. **NIP-28** (Kind 42 channel messages)
   - Replies within channel context
   - Different tag structure

4. **NIP-29** (Kinds 10, 11, 12 group messages)
   - Group-specific threading
   - Additional permissions layer

### Current Implementation

- ✅ Kind1Renderer shows NIP-10 reply indicator
- ✅ Uses `getNip10References` from applesauce
- ❌ No support for NIP-22 (Kind 1111 not implemented)
- ❌ No support for other threading models
- ❌ No generic threading components

### Proposed Abstraction

**Helper Layer:**
```tsx
// src/lib/threading.ts
export interface ThreadReference {
  type: 'nip10' | 'nip22' | 'nip28' | 'nip29';
  root?: EventPointer | AddressPointer | string; // string for external (NIP-22)
  parent?: EventPointer | AddressPointer | string;
  mentions?: Array<EventPointer | AddressPointer>;
  rootAuthor?: string;
  parentAuthor?: string;
}

export function getThreadReferences(event: NostrEvent): ThreadReference | null {
  // Detect threading model by kind and tags
  if (event.kind === 1) return getNip10Thread(event);
  if (event.kind === 1111) return getNip22Thread(event);
  if (event.kind === 42) return getNip28Thread(event);
  // ... etc
  return null;
}
```

**Component Layer:**
```tsx
// Generic thread indicator
export function ThreadIndicator({ event, depth = 0 }) {
  const refs = getThreadReferences(event);
  if (!refs) return null;

  const parentEvent = useNostrEvent(refs.parent);

  return (
    <div className="thread-indicator">
      <Reply className="icon" />
      <span>Replying to</span>
      {parentEvent ? (
        <ThreadPreview event={parentEvent} depth={depth} />
      ) : refs.type === 'nip22' && typeof refs.parent === 'string' ? (
        <ExternalThreadContext url={refs.parent} />
      ) : (
        <LoadingIndicator />
      )}
    </div>
  );
}

// Generic thread tree (for detail view)
export function ThreadTree({ rootEvent }) {
  const replies = useReplies(rootEvent);
  return (
    <div className="thread-tree">
      {replies.map(reply => (
        <ThreadBranch key={reply.id} event={reply} />
      ))}
    </div>
  );
}
```

**Benefits:**
- ✅ Single component works across all threading models
- ✅ Extensible to new NIPs
- ✅ Reusable across different renderers
- ✅ Consistent UX for users
- ✅ Easier to maintain (one place to fix threading bugs)

---

## Part 6: Metadata Extraction Patterns

### Current Approaches

1. **Applesauce Helpers** ✅ (GOOD)
   - `getArticleTitle`, `getZapAmount`, `getNip10References`
   - Well-tested, consistent, handles edge cases
   - Examples: `Kind30023Renderer`, `Kind9735Renderer`

2. **Manual Tag Parsing** ⚠️ (INCONSISTENT)
   - `event.tags.find(t => t[0] === "e")`
   - Error-prone, repeated code, misses edge cases
   - Examples: `Kind6Renderer`, various places

3. **JSON Parsing** ❌ (ERROR-PRONE)
   - `JSON.parse(event.content)` without try/catch
   - Can crash entire app if malformed
   - Examples: Profile metadata, relay lists

### What Applesauce Provides

Currently has helpers for:
- ✅ Articles (30023): title, summary, published, image
- ✅ Zaps (9735): amount, sender, request, pointers
- ✅ Threading (1): NIP-10 references
- ✅ Profiles (0): metadata parsing
- ✅ Relays: seen relays, relay hints

### What's Missing

Need helpers for:
- ❌ File metadata (1063): url, hash, size, mime, dimensions
- ❌ Media events (20, 21, 22): URLs, thumbnails, dimensions
- ❌ List events (30000+): systematic list item extraction
- ❌ Comments (1111): NIP-22 uppercase/lowercase tag parsing
- ❌ Reactions (7): emoji normalization (+ → ❤️)
- ❌ Reposts (6, 16, 18): reposted event extraction
- ❌ Highlights (9802): context, highlight text
- ❌ Calendar events (31922-31925): date/time parsing
- ❌ Polls (1068): options, votes, tally
- ❌ Communities (34550): community info extraction

### Recommendation

**Architecture Principle:** Renderers should NEVER parse tags/content directly.

```tsx
// BAD ❌
const eTag = event.tags.find(t => t[0] === "e")?.[1];

// GOOD ✅
import { getRepostedEvent } from '@/lib/helpers/repost';
const repostPointer = getRepostedEvent(event);
```

**Action Items:**
1. Contribute missing helpers to applesauce-core (if generic)
2. Create local helper library for Grimoire-specific needs
3. Audit all renderers, replace manual parsing with helpers
4. Enforce via ESLint rule: no direct `event.tags.find`

---

## Part 7: Performance & Scalability

### Current Bottlenecks

1. **No Virtualization**
   - All events in feed render immediately
   - 1000 events = 1000 DOM nodes = slow scroll
   - Wastes memory on off-screen content

2. **No Memoization**
   - RichText parses content on every render
   - Profile lookups happen repeatedly
   - JSON.parse re-runs unnecessarily
   - Expensive computations not cached

3. **No Lazy Loading**
   - All renderer code loaded upfront
   - ~20 renderer components = large initial bundle
   - Could code-split by kind

4. **Heavy Base Components**
   - Every event has `BaseEventContainer` overhead
   - Profile fetch for every `EventAuthor`
   - Could batch profile fetches

5. **Cascading Fetches**
   - Embedded event triggers fetch
   - That event might embed another
   - Exponential growth without depth limiting

### Good News

- ✅ EventStore handles deduplication
- ✅ Dexie provides offline caching
- ✅ Reactive system (RxJS) is efficient

### Solutions

**1. Virtual Scrolling**
```tsx
import { Virtuoso } from 'react-virtuoso';

function EventFeed({ events }) {
  return (
    <Virtuoso
      data={events}
      itemContent={(index, event) => (
        <KindRenderer event={event} />
      )}
    />
  );
}
```

**2. Memoization**
```tsx
// Wrap all renderers
export const Kind1Renderer = React.memo(({ event, depth }) => {
  const refs = useMemo(() => getNip10References(event), [event.id]);
  const handleClick = useCallback(() => {...}, [event.id]);

  return <BaseEventContainer event={event}>
    <RichText event={event} depth={depth} />
  </BaseEventContainer>;
});
```

**3. Code Splitting**
```tsx
// Lazy load detail renderers
const Kind30023DetailRenderer = lazy(() =>
  import('./kinds/Kind30023DetailRenderer')
);

// Use with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <Kind30023DetailRenderer event={event} />
</Suspense>
```

**4. Batch Profile Fetches**
```tsx
// Instead of individual useProfile in every EventAuthor
// Batch load all visible profiles
function EventFeed({ events }) {
  const pubkeys = useMemo(() =>
    events.map(e => e.pubkey), [events]
  );
  useBatchProfiles(pubkeys); // Prefetch

  return events.map(e => <KindRenderer event={e} />);
}
```

**Performance Targets:**
- Feed with 10,000 events: Smooth 60fps scroll
- Initial render: < 100ms
- Event interaction: < 50ms response
- Bundle size: < 300KB for core, lazy load rest

---

## Part 8: Error Handling & Resilience

### Current Error Scenarios

1. **Malformed Events**
   - Invalid JSON in content
   - Missing required tags
   - Incorrect tag structure

2. **Network Failures**
   - Relays timeout
   - Event not found
   - Incomplete data

3. **Parsing Failures**
   - Markdown rendering errors
   - NIP-19 decode failures
   - Media load failures

4. **Rendering Errors**
   - Component crashes
   - Infinite loops (depth issue)
   - Out of memory

### Current Handling

- ⚠️ Some try/catch in parsers (inconsistent)
- ⚠️ EmbeddedEvent shows "Loading..." forever if fetch fails
- ❌ No error boundaries around renderers
- ✅ DefaultKindRenderer for unknown kinds (good!)

### Solution: Error Boundaries

```tsx
// Per-event error boundary
export function EventErrorBoundary({ children, event }) {
  return (
    <ErrorBoundary
      fallback={({ error, resetErrorBoundary }) => (
        <div className="event-error-card">
          <AlertCircle className="icon" />
          <div>
            <h4>Failed to render event</h4>
            <p className="text-sm text-muted-foreground">
              Kind {event.kind} • {event.id.slice(0, 8)}
            </p>
            <details>
              <summary>Error details</summary>
              <pre>{error.message}</pre>
            </details>
          </div>
          <div className="actions">
            <button onClick={resetErrorBoundary}>Retry</button>
            <button onClick={() => viewJson(event)}>View JSON</button>
            <button onClick={() => reportIssue(event, error)}>Report</button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

// Usage in feed
{events.map(event => (
  <EventErrorBoundary key={event.id} event={event}>
    <KindRenderer event={event} />
  </EventErrorBoundary>
))}
```

**Benefits:**
- ✅ One broken event doesn't break entire feed
- ✅ User gets actionable error info
- ✅ Developer gets diagnostics
- ✅ Graceful degradation

---

## Part 9: Accessibility & Internationalization

### Accessibility Gaps

**Keyboard Navigation:**
- ❌ No keyboard shortcuts for common actions
- ❌ Can't navigate between events with Tab
- ❌ Can't expand/collapse without mouse

**Screen Reader Support:**
- ❌ EventMenu has no aria-label
- ❌ Embedded events don't announce properly
- ❌ Time stamps are "2h ago" but no absolute time for SR
- ⚠️ BaseEventContainer uses `<div>` not `<article>`

**Visual:**
- ⚠️ Muted text might not meet WCAG AA contrast
- ❌ No prefers-reduced-motion support
- ❌ Focus indicators inconsistent

**RTL Support:**
- ❌ Noted in TODO as partially implemented
- ❌ Inline elements conflict with RTL alignment

### I18n Gaps

- ⚠️ Timestamps use locale from state but inconsistently
- ❌ Number formatting hardcoded to "en" (zap amounts)
- ❌ Kind names are English-only strings
- ❌ Error messages hardcoded English
- ❌ No language detection for content

### Solutions

**Semantic HTML:**
```tsx
export function BaseEventContainer({ event, children }) {
  return (
    <article className="event-card" aria-labelledby={`event-${event.id}`}>
      <header className="event-header">
        <EventAuthor pubkey={event.pubkey} />
        <time dateTime={...} aria-label={absoluteTime}>
          {relativeTime}
        </time>
        <EventMenu event={event} aria-label="Event actions" />
      </header>
      <section className="event-content">{children}</section>
    </article>
  );
}
```

**Keyboard Navigation:**
```tsx
// Arrow keys to navigate events
// Enter to open detail
// Escape to close
// Tab to focus actions
useKeyboardNavigation({
  onUp: () => focusPrevEvent(),
  onDown: () => focusNextEvent(),
  onEnter: () => openEventDetail(),
});
```

**I18n:**
```tsx
import { useTranslation } from 'react-i18next';

export function EventMenu({ event }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem>
      {t('event.actions.copy_id')}
    </DropdownMenuItem>
  );
}
```

---

## Part 10: Developer Experience

### Current DX

**Good:**
- ✅ Clear file structure (`src/components/nostr/kinds/`)
- ✅ TypeScript types (`BaseEventProps`)
- ✅ README documenting pattern
- ✅ Consistent naming (`KindXRenderer`)

**Friction:**
- ❌ Can't hot-reload new renderer without modifying `index.tsx`
- ❌ No component gallery (Storybook)
- ❌ Hard to test renderers in isolation
- ❌ Manual registration in multiple places
- ❌ No development tooling (event inspector)
- ❌ No renderer generator CLI

### Ideal DX

**1. Convention-Based Registration**
```bash
# Just create the file, auto-discovered
src/components/nostr/kinds/Kind1111Renderer.tsx
# No need to modify index.tsx
```

**2. Component Gallery**
```tsx
// Visit /dev/renderers in dev mode
// Browse all renderers with sample events
// Test with different contexts (feed/detail/embed)
// Inspect props, performance
```

**3. Testing Utilities**
```tsx
import { renderKind, mockEvent } from '@/test/utils';

test('Kind1Renderer displays content', () => {
  const event = mockEvent({ kind: 1, content: 'Hello' });
  const { getByText } = renderKind(1, event);
  expect(getByText('Hello')).toBeInTheDocument();
});
```

**4. Generator CLI**
```bash
npm run generate:renderer -- --kind 1111 --nip 22
# Scaffolds:
# - Kind1111Renderer.tsx with boilerplate
# - Kind1111Renderer.test.tsx
# - Updates registry
# - Adds to documentation
```

**5. Dev Tools**
```tsx
// Browser extension or dev panel
<EventInspector event={event}>
  <KindRenderer event={event} />
</EventInspector>
// Shows: props, state, performance, helper calls, errors
```

---

## Part 11: What's Working Well (To Preserve)

These patterns are **strengths** to maintain and enhance:

1. ✅ **Registry Pattern**: Centralized kind → renderer mapping
2. ✅ **BaseEventContainer**: Consistent header/footer
3. ✅ **Applesauce Integration**: Using library helpers
4. ✅ **Type Safety**: TypeScript interfaces
5. ✅ **Separation of Concerns**: Rendering separate from data fetching
6. ✅ **Recursive Rendering**: KindRenderer can nest
7. ✅ **Universal Actions**: EventMenu available everywhere
8. ✅ **Event Identity**: Good handling of regular vs addressable
9. ✅ **Default Fallback**: Unknown kinds still display
10. ✅ **Component Reuse**: EmbeddedEvent, MediaEmbed, RichText

**Don't throw away these foundations - build on them!**

---

## Part 12: Comprehensive Improvement Roadmap

### Phase 1: Foundation Fixes (1-2 weeks)
**Goal:** Fix critical architectural issues and quick wins

**1.1 Unified Detail Renderer Registry**
- Remove hardcoded switch in EventDetailViewer
- Create `detailRenderers` map parallel to `kindRenderers`
- Fallback logic: detail → feed → default
- Files: `src/components/nostr/kinds/index.tsx`, `EventDetailViewer.tsx`
- **Impact:** HIGH | **Effort:** LOW

**1.2 Systematic Depth Tracking**
- Add `MAX_EMBED_DEPTH` constant
- Update `BaseEventProps` to require depth
- Audit all renderers using `EmbeddedEvent`
- Implement `CollapsedPreview` for max depth
- Files: All `*Renderer.tsx` files
- **Impact:** HIGH | **Effort:** MEDIUM

**1.3 Error Boundaries**
- Create `EventErrorBoundary` component
- Wrap all events in feeds
- Add diagnostic error cards
- File: `src/components/EventErrorBoundary.tsx`
- **Impact:** HIGH | **Effort:** LOW

**1.4 Fix JSON Viewer Scrolling**
- From TODO: "JSON viewer scrolling"
- Add `overflow-auto` and `max-height` to JSON container
- File: `src/components/JsonViewer.tsx`
- **Impact:** MEDIUM | **Effort:** TRIVIAL

**1.5 Renderer Memoization**
- Wrap all renderer components with `React.memo`
- Add `useMemo` for expensive computations
- Add `useCallback` for handlers
- Files: All `*Renderer.tsx` files
- **Impact:** MEDIUM | **Effort:** LOW

**Deliverables:**
- [ ] Detail renderer registry implemented
- [ ] All renderers honor depth (with tests)
- [ ] Error boundaries deployed
- [ ] JSON viewer scrolls properly
- [ ] All renderers memoized

---

### Phase 2: Component Library (2-3 weeks)
**Goal:** Build reusable abstractions for common patterns

**2.1 Generic Threading Components**
- `getThreadReferences()` helper supporting NIP-10, NIP-22, NIP-28
- `<ThreadIndicator>` component
- `<ThreadContext>` for parent preview
- `<ThreadTree>` for detail view reply chains
- Files: `src/lib/threading.ts`, `src/components/Thread/`
- **Impact:** HIGH | **Effort:** HIGH

**2.2 NIP-22 Comment Support**
- Implement `Kind1111Renderer` (from TODO)
- NIP-22 tag parsing helpers (K/k, E/e, A/a, I/i, P/p)
- External identifier display (I tags)
- Nested comment threading
- Files: `src/lib/helpers/nip22.ts`, `src/components/nostr/kinds/Kind1111Renderer.tsx`
- **Impact:** HIGH | **Effort:** HIGH

**2.3 Relationship Panels**
- `<RepliesPanel>` - Show replies to event
- `<ZapsPanel>` - Show zaps with total/list
- `<ReactionsPanel>` - Group reactions by emoji
- `<EngagementFooter>` - Universal engagement indicators
- Use in detail renderers
- Files: `src/components/nostr/Relationships/`
- **Impact:** MEDIUM | **Effort:** MEDIUM

**2.4 Enhanced Media Components**
- Multi-stage rendering (placeholder → thumbnail → full → error)
- Lazy loading with IntersectionObserver
- NSFW blur with content-warning tag support
- Quality selection for videos
- Accessibility improvements (alt text, captions)
- Files: Enhance `src/components/nostr/MediaEmbed.tsx`
- **Impact:** MEDIUM | **Effort:** MEDIUM

**2.5 Context-Aware Rendering**
- Add `context` prop to BaseEventProps
- Renderers adapt to feed vs detail vs embed
- Update all existing renderers
- Files: `src/components/nostr/kinds/index.tsx`, all renderers
- **Impact:** MEDIUM | **Effort:** LOW

**Deliverables:**
- [ ] Threading works across NIP-10, NIP-22, NIP-28
- [ ] Kind 1111 (comments) fully functional
- [ ] Detail views show relationships
- [ ] Media rendering has all stages
- [ ] Context awareness implemented

---

### Phase 3: Architecture Evolution (3-4 weeks)
**Goal:** Transform into production-grade framework

**3.1 Performance Optimization**
- Virtual scrolling with react-virtuoso
- Code splitting for detail renderers
- Batch profile fetching
- Suspense boundaries
- Performance monitoring
- Files: `src/components/ReqViewer.tsx`, `EventDetailViewer.tsx`
- **Impact:** HIGH | **Effort:** MEDIUM

**3.2 Helper Library Expansion**
- Audit all renderers for manual tag parsing
- Create helpers for all missing NIPs:
  - File metadata (1063)
  - Media events (20, 21, 22)
  - Lists (30000+)
  - Reposts (6, 16, 18)
  - Highlights (9802)
  - Calendar (31922-31925)
  - Polls (1068)
- Submit generic ones to applesauce-core
- Files: `src/lib/helpers/` directory structure
- **Impact:** HIGH | **Effort:** HIGH

**3.3 Accessibility Improvements**
- Semantic HTML (`<article>`, `<time>`, proper headings)
- ARIA labels and roles
- Keyboard navigation system
- Focus management
- Screen reader testing and fixes
- WCAG AA compliance audit
- Files: All renderers, BaseEventContainer
- **Impact:** MEDIUM | **Effort:** MEDIUM

**3.4 Internationalization**
- i18next integration
- Extract all hardcoded strings
- Locale-aware number/date formatting
- Kind name translations
- RTL support improvements
- Files: Setup i18n infrastructure, translate all components
- **Impact:** MEDIUM | **Effort:** MEDIUM

**3.5 Composable Renderer System**
- Break renderers into smaller components:
  - Content components (primary payload)
  - Metadata components (structured data)
  - Relationship components (connections)
  - Action components (interactions)
- Enable mix-and-match composition
- Files: Refactor all complex renderers
- **Impact:** MEDIUM | **Effort:** HIGH

**Deliverables:**
- [ ] Smooth 60fps scroll with 10K events
- [ ] All NIPs have helper functions
- [ ] WCAG AA compliant
- [ ] Multi-language support
- [ ] Composable renderer architecture

---

### Phase 4: Developer Experience (2-3 weeks)
**Goal:** Make development delightful and efficient

**4.1 Component Gallery (Storybook)**
- Setup Storybook
- Create stories for all renderers
- Mock event generator
- Interactive playground
- Visual regression testing
- Files: `.storybook/`, `src/components/nostr/kinds/*.stories.tsx`
- **Impact:** HIGH | **Effort:** MEDIUM

**4.2 Testing Infrastructure**
- Test utilities: `renderKind()`, `mockEvent()`
- Unit tests for all helpers
- Integration tests for renderers
- E2E tests for common flows
- Coverage targets (>80%)
- Files: `src/test/`, `*.test.tsx` for all renderers
- **Impact:** HIGH | **Effort:** HIGH

**4.3 Generator CLI**
- `generate:renderer` command
- Scaffolds: renderer, tests, types
- Auto-updates registry
- Generates documentation stub
- Files: `scripts/generate-renderer.ts`
- **Impact:** MEDIUM | **Effort:** LOW

**4.4 Development Tools**
- Event inspector dev panel
- Performance profiler
- Helper call tracer
- Error diagnostic viewer
- Files: `src/dev-tools/`
- **Impact:** MEDIUM | **Effort:** MEDIUM

**4.5 Documentation**
- Architecture guide (this document as living docs)
- Renderer patterns guide
- Helper function reference
- Contribution guide
- API documentation (TypeDoc)
- Files: `docs/` directory
- **Impact:** HIGH | **Effort:** MEDIUM

**Deliverables:**
- [ ] Storybook with all renderers
- [ ] >80% test coverage
- [ ] Renderer generator working
- [ ] Dev tools panel functional
- [ ] Comprehensive documentation

---

## Part 13: Success Metrics

**Phase 1 Success:**
- Zero infinite loop bugs
- <1% event rendering errors in production
- Detail renderers added without modifying router

**Phase 2 Success:**
- NIP-22 comments working end-to-end
- Detail views show full relationship context
- All threading models supported

**Phase 3 Success:**
- 10K event feed scrolls at 60fps
- Zero manual tag parsing in renderers
- WCAG AA accessibility audit passes

**Phase 4 Success:**
- New renderer takes <30min to scaffold
- >80% test coverage maintained
- Storybook has 100% renderer coverage

**Overall Success:**
- Contributors can add renderers without asking questions
- Users report high quality, responsive UI
- Grimoire becomes reference implementation for Nostr clients

---

## Part 14: Priority Decision Matrix

**Immediate (Week 1-2):**
1. Detail renderer registry fix
2. Depth tracking safety
3. Error boundaries
4. JSON viewer scroll fix

**Short-term (Week 3-6):**
1. NIP-22 comment support (user request in TODO)
2. Threading abstraction
3. Memoization & performance basics
4. Relationship panels

**Medium-term (Week 7-12):**
1. Virtual scrolling
2. Helper library expansion
3. Accessibility improvements
4. Component gallery

**Long-term (Month 4+):**
1. Plugin architecture
2. Advanced dev tools
3. Full i18n
4. Composable system evolution

---

## Part 15: Risk Assessment

**Technical Risks:**
- 🟡 **Breaking changes**: Depth prop changes might break existing renderers
  - *Mitigation:* Make depth optional with default 0, gradual rollout
- 🟡 **Performance regression**: Memoization might increase memory
  - *Mitigation:* Monitor metrics, iterate based on data
- 🟢 **Compatibility**: Changes to BaseEventProps might affect community code
  - *Mitigation:* Keep backward compatibility, deprecate gradually

**Resource Risks:**
- 🟡 **Time**: 10-12 weeks of focused work
  - *Mitigation:* Phased approach, can ship incrementally
- 🟢 **Expertise**: Some NIPs are complex (NIP-22, NIP-29)
  - *Mitigation:* Study specifications, prototype early

**User Impact:**
- 🟢 **Disruption**: Most changes are internal improvements
- 🟢 **Testing**: Can test thoroughly in staging before production
- 🟢 **Rollback**: Registry pattern makes rollback easy (swap renderers)

---

## Conclusion

The Grimoire event rendering system has **excellent foundations** but needs **systematic improvements** to scale from prototype to production.

**The path forward:**
1. ✅ **Preserve** what works (registry, base components, type safety)
2. 🔧 **Fix** critical issues (detail registry, depth tracking, error handling)
3. 🏗️ **Build** missing abstractions (threading, relationships, helpers)
4. ⚡ **Optimize** performance (virtualization, memoization, lazy loading)
5. 🎨 **Polish** UX (accessibility, i18n, media rendering)
6. 🛠️ **Empower** developers (tooling, testing, documentation)

**This roadmap transforms the system from "working" to "world-class" in ~3 months** with measurable success criteria and manageable risk.

The result will be a **reference implementation** that other Nostr clients can learn from and contribute to.

---

**Next Steps:**
1. Review this analysis with team/community
2. Prioritize phases based on user feedback
3. Create GitHub issues/project board from roadmap
4. Begin Phase 1 implementation
5. Update TODO.md with prioritized items

**Questions for Discussion:**
- Which Phase 1 items are most critical?
- Should we tackle NIP-22 (comments) in Phase 1 given TODO mention?
- What's the community appetite for contributing to applesauce helpers?
- Performance targets: 10K events reasonable or aim higher/lower?
- Should we build plugin architecture in Phase 3 or defer?
