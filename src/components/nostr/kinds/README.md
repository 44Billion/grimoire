# Kind Renderer System

A flexible system for rendering different Nostr event kinds with custom components while sharing universal properties like author info and event actions.

## Architecture

### Core Components

**`BaseEventRenderer.tsx`** - Universal components shared across all renderers:
- `EventAuthor` - Displays user info with profile and NIP-05
- `EventMenu` - Context menu with copy ID, view JSON actions
- `BaseEventContainer` - Wrapper with header and universal layout

**`index.tsx`** - Registry and main entry point:
- `KindRenderer` - Main component that routes to appropriate renderer
- `kindRenderers` - Registry mapping kinds to components
- `DefaultKindRenderer` - Fallback for unregistered kinds

## Creating a Custom Renderer

### 1. Create a new renderer file

Example: `Kind7Renderer.tsx` for Reactions

```tsx
import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";

export function Kind7Renderer({ event }: BaseEventProps) {
  return (
    <BaseEventContainer event={event}>
      {/* Your custom rendering logic here */}
      <div className="text-sm">
        reacted with {event.content}
      </div>
    </BaseEventContainer>
  );
}
```

### 2. Register in the index

Edit `index.tsx`:

```tsx
import { Kind7Renderer } from "./Kind7Renderer";

const kindRenderers: Record<number, React.ComponentType<BaseEventProps>> = {
  1: Kind1Renderer,
  7: Kind7Renderer,  // Add your renderer
  // ...
};

// Export it
export { Kind7Renderer } from "./Kind7Renderer";
```

### 3. Use in feeds

The `KindRenderer` automatically picks the right renderer:

```tsx
import { KindRenderer } from "./kinds";

function FeedEvent({ event }) {
  return <KindRenderer event={event} />;
}
```

## Available Props

All custom renderers receive `BaseEventProps`:

```tsx
interface BaseEventProps {
  event: NostrEvent;  // Full Nostr event with id, pubkey, content, tags, etc.
}
```

## Reusable Components

You can use these in custom renderers:

- `<EventAuthor pubkey={event.pubkey} />` - User profile display
- `<EventMenu event={event} />` - Context menu
- `<BaseEventContainer event={event}>` - Standard wrapper with header

Or build completely custom layouts without them.

## Examples

### Kind 1 - Short Text Note
```tsx
export function Kind1Renderer({ event }: BaseEventProps) {
  return (
    <BaseEventContainer event={event}>
      <RichText event={event} className="text-sm" />
    </BaseEventContainer>
  );
}
```

### Kind 6 - Repost
```tsx
export function Kind6Renderer({ event }: BaseEventProps) {
  const eTag = event.tags.find((tag) => tag[0] === "e");
  return (
    <BaseEventContainer event={event}>
      <div className="flex items-center gap-2">
        <Repeat2 className="size-4" />
        <span>reposted {eTag?.[1]}</span>
      </div>
    </BaseEventContainer>
  );
}
```

### Kind 7 - Reaction
```tsx
export function Kind7Renderer({ event }: BaseEventProps) {
  return (
    <BaseEventContainer event={event}>
      <div className="flex items-center gap-2">
        <span>reacted with</span>
        <span className="text-xl">{event.content || "❤️"}</span>
      </div>
    </BaseEventContainer>
  );
}
```

## Benefits

- **Consistency**: Universal author/menu UI across all kinds
- **Flexibility**: Each kind can have completely custom rendering
- **Extensibility**: Add new kinds without modifying existing code
- **Type Safety**: TypeScript ensures all renderers match the interface
- **Default Fallback**: Unknown kinds still render with basic info
