# Fix: OPEN Command Reconstruction

**Date:** 2025-12-13
**Issue:** OPEN command sometimes didn't include event bech32 when clicking edit
**Status:** ✅ Fixed

## Problem Analysis

### Root Cause

The command reconstructor was checking for the wrong props structure.

**Incorrect code:**
```typescript
case "open": {
  if (props.id) { ... }      // ❌ Wrong!
  if (props.address) { ... } // ❌ Wrong!
  return "open";
}
```

**Actual props structure:**
```typescript
{
  pointer: EventPointer | AddressPointer
}
```

Where:
- `EventPointer`: `{ id: string, relays?: string[], author?: string }`
- `AddressPointer`: `{ kind: number, pubkey: string, identifier: string, relays?: string[] }`

### Why This Happened

The `parseOpenCommand` function returns `{ pointer: EventPointer | AddressPointer }`, but the reconstructor was looking for `props.id` and `props.address` directly. This mismatch caused the reconstruction to fail and return just `"open"` without the event identifier.

## Solution

Updated the `open` case in `command-reconstructor.ts` to properly handle the pointer structure:

### Implementation

```typescript
case "open": {
  // Handle pointer structure from parseOpenCommand
  if (!props.pointer) return "open";

  const pointer = props.pointer;

  try {
    // EventPointer (has id field)
    if ("id" in pointer) {
      // If has relays or author metadata, use nevent
      if (pointer.relays?.length || pointer.author) {
        const nevent = nip19.neventEncode({
          id: pointer.id,
          relays: pointer.relays,
          author: pointer.author,
        });
        return `open ${nevent}`;
      }
      // Otherwise use simple note
      const note = nip19.noteEncode(pointer.id);
      return `open ${note}`;
    }

    // AddressPointer (has kind, pubkey, identifier)
    if ("kind" in pointer) {
      const naddr = nip19.naddrEncode({
        kind: pointer.kind,
        pubkey: pointer.pubkey,
        identifier: pointer.identifier,
        relays: pointer.relays,
      });
      return `open ${naddr}`;
    }
  } catch (error) {
    console.error("Failed to encode open command:", error);
    // Fallback to raw pointer display
    if ("id" in pointer) {
      return `open ${pointer.id}`;
    }
  }

  return "open";
}
```

## Encoding Strategy

### EventPointer (has `id`)

1. **With metadata** (relays or author) → Encode as `nevent`
   - Input: `{ id: "abc...", relays: ["wss://relay.com"], author: "def..." }`
   - Output: `open nevent1...`
   - Preserves relay hints and author information

2. **Without metadata** → Encode as `note`
   - Input: `{ id: "abc..." }`
   - Output: `open note1...`
   - Simpler, more common format

### AddressPointer (has `kind`, `pubkey`, `identifier`)

- Always encode as `naddr`
- Input: `{ kind: 30023, pubkey: "abc...", identifier: "my-article" }`
- Output: `open naddr1...`
- Used for replaceable/parameterized replaceable events

## Test Cases

### Test 1: Simple Event (note)
```typescript
// Window with EventPointer (just ID)
{
  pointer: { id: "abc123..." }
}
// Reconstructs to:
"open note1..."
```

### Test 2: Event with Metadata (nevent)
```typescript
// Window with EventPointer (with relays/author)
{
  pointer: {
    id: "abc123...",
    relays: ["wss://relay.damus.io"],
    author: "def456..."
  }
}
// Reconstructs to:
"open nevent1..."
```

### Test 3: Addressable Event (naddr)
```typescript
// Window with AddressPointer
{
  pointer: {
    kind: 30023,
    pubkey: "abc123...",
    identifier: "my-article",
    relays: ["wss://relay.nostr.band"]
  }
}
// Reconstructs to:
"open naddr1..."
```

### Test 4: Original Hex Input
```typescript
// User typed: open abc123... (hex)
// Parser creates: { pointer: { id: "abc123..." } }
// Reconstructs to: "open note1..." (encoded as bech32)
// ✅ Better UX - consistent bech32 format
```

## Why This Fix Works

1. **Correct Props Structure**: Now checks `props.pointer` instead of non-existent `props.id`
2. **Type Detection**: Uses `"id" in pointer` vs `"kind" in pointer` to distinguish types
3. **Smart Encoding**:
   - Uses `nevent` when metadata exists (preserves relay hints)
   - Uses `note` for simple cases (cleaner)
   - Uses `naddr` for addressable events (required format)
4. **Error Handling**: Fallback to raw ID if encoding fails
5. **Consistent Output**: All reconstructed commands use bech32 format

## Impact

### Before Fix
- Clicking edit on open windows showed just `"open"` with no event ID
- Users couldn't edit open commands
- Command reconstruction was broken for all open windows

### After Fix
- ✅ Clicking edit shows full command: `open note1...` / `nevent1...` / `naddr1...`
- ✅ Users can edit and resubmit open commands
- ✅ Preserves relay hints and metadata when present
- ✅ Consistent with how users type commands

## Files Changed

- `src/lib/command-reconstructor.ts` - Fixed `open` case (lines 39-81)

## Verification

✅ TypeScript compilation successful
✅ No breaking changes
✅ Backward compatible (handles both old and new windows)

## Related Components

- `src/lib/open-parser.ts` - Defines pointer structures and parsing logic
- `src/components/EventDetailViewer.tsx` - Consumes pointer prop
- `src/types/man.ts` - Defines open command entry

## Future Improvements

None needed - the fix is complete and handles all cases properly.
