# Applesauce Helpers Refactoring Plan

## Executive Summary

After investigating applesauce-core helpers and grimoire's codebase, I've identified several opportunities to leverage applesauce's built-in helpers and caching mechanisms. **Key insight**: Applesauce helpers use internal caching via symbols (`getOrComputeCachedValue`), so we don't need `useMemo` when calling them.

## Key Findings

### 1. Applesauce Caching System

Applesauce helpers cache computed values on event objects using symbols:
```typescript
// From applesauce-core/helpers/cache.d.ts
export declare function getOrComputeCachedValue<T>(
  event: any,
  symbol: symbol,
  compute: () => T
): T;
```

**Implication**: When you call helpers like `getArticleTitle(event)`, `getHighlightText(event)`, etc., the result is cached on the event object. Subsequent calls return the cached value instantly. **We don't need useMemo for applesauce helper calls.**

### 2. Already Using Applesauce Helpers

Grimoire already imports and uses many applesauce helpers correctly:
- ✅ `getTagValue` - used extensively in nip34-helpers.ts, nip-c0-helpers.ts
- ✅ `getNip10References` - used in nostr-utils.ts
- ✅ `getCommentReplyPointer` - used in nostr-utils.ts
- ✅ Article helpers - `getArticleTitle`, `getArticleSummary` (ArticleRenderer.tsx)
- ✅ Highlight helpers - all 6+ helpers used (HighlightRenderer.tsx, HighlightDetailRenderer.tsx)
- ✅ Code snippet helpers - imported from nip-c0-helpers.ts

### 3. Applesauce Helpers Available but Not Used

#### Profile Helpers
```typescript
// applesauce-core/helpers/profile
export function getDisplayName(
  metadata: ProfileContent | NostrEvent | undefined,
  fallback?: string
): string | undefined;
```

**Current grimoire code** (src/lib/nostr-utils.ts:65-76):
```typescript
export function getDisplayName(
  pubkey: string,
  metadata?: ProfileContent,
): string {
  if (metadata?.display_name) return metadata.display_name;
  if (metadata?.name) return metadata.name;
  return derivePlaceholderName(pubkey);
}
```

**Issue**: Grimoire's version requires both `pubkey` and `metadata`, while applesauce only takes `metadata`. Our version adds fallback logic with `derivePlaceholderName`.

**Recommendation**: Keep grimoire's version - it provides better UX with pubkey-based fallback.

#### Pointer Helpers
```typescript
// applesauce-core/helpers/pointers
export function getEventPointerFromETag(tag: string[]): EventPointer;
export function getEventPointerFromQTag(tag: string[]): EventPointer;
export function getAddressPointerFromATag(tag: string[]): AddressPointer;
export function getProfilePointerFromPTag(tag: string[]): ProfilePointer;
export function parseCoordinate(a: string): AddressPointerWithoutD | null;
```

**Current usage** in ReactionRenderer.tsx:58-66:
```typescript
const addressParts = useMemo(() => {
  if (!reactedAddress) return null;
  const parts = reactedAddress.split(":");
  return {
    kind: parseInt(parts[0], 10),
    pubkey: parts[1],
    dTag: parts[2],
  };
}, [reactedAddress]);
```

**Recommendation**: Replace manual parsing with `parseCoordinate` helper.

#### Reaction Pointer Helpers
```typescript
// applesauce-core/helpers/reactions
export function getReactionEventPointer(event: NostrEvent): EventPointer | undefined;
export function getReactionAddressPointer(event: NostrEvent): AddressPointer | undefined;
```

**Current usage** in ReactionRenderer.tsx: Manual tag extraction and parsing.

**Recommendation**: Use built-in reaction pointer helpers.

#### Filter Comparison Helper
```typescript
// applesauce-core/helpers/filter
export function isFilterEqual(
  a: FilterWithAnd | FilterWithAnd[],
  b: FilterWithAnd | FilterWithAnd[]
): boolean;
```

**Current usage** in useStable.ts:55-58:
```typescript
export function useStableFilters<T>(filters: T): T {
  return useMemo(() => filters, [JSON.stringify(filters)]);
}
```

**Recommendation**: Replace JSON.stringify comparison with `isFilterEqual` for more robust filter comparison.

### 4. Custom Helpers We Need to Keep

These are **not** available in applesauce and provide grimoire-specific functionality:

1. **`getTagValues` (plural)** - src/lib/nostr-utils.ts:59-63
   ```typescript
   export function getTagValues(event: NostrEvent, tagName: string): string[] {
     return event.tags
       .filter((tag) => tag[0] === tagName && tag[1])
       .map((tag) => tag[1]);
   }
   ```
   **Keep**: Applesauce only has `getTagValue` (singular). We need the plural version.

2. **`resolveFilterAliases`** - src/lib/nostr-utils.ts:85-156
   - Resolves `$me` and `$contacts` in filters
   - Grimoire-specific feature
   **Keep**: No applesauce equivalent.

3. **NIP-34 helpers** - src/lib/nip34-helpers.ts
   - Git repository, issue, patch, PR helpers
   **Keep**: Grimoire-specific, uses `getTagValue` underneath.

4. **NIP-C0 helpers** - src/lib/nip-c0-helpers.ts
   - Code snippet helpers
   **Keep**: Uses `getTagValue` underneath, grimoire-specific.

5. **Custom event processing** - src/lib/spell-conversion.ts, spellbook-manager.ts
   **Keep**: Grimoire-specific functionality.

## Refactoring Opportunities

### HIGH PRIORITY: Remove Unnecessary useMemo

Since applesauce helpers cache internally, **remove useMemo from all applesauce helper calls**:

#### 1. ArticleRenderer.tsx (lines 17-18)
```typescript
// BEFORE
const title = useMemo(() => getArticleTitle(event), [event]);
const summary = useMemo(() => getArticleSummary(event), [event]);

// AFTER - helpers cache internally
const title = getArticleTitle(event);
const summary = getArticleSummary(event);
```

#### 2. HighlightRenderer.tsx (lines 24-36) + HighlightDetailRenderer.tsx (lines 22-35)
```typescript
// BEFORE
const highlightText = useMemo(() => getHighlightText(event), [event]);
const sourceUrl = useMemo(() => getHighlightSourceUrl(event), [event]);
const comment = useMemo(() => getHighlightComment(event), [event]);
const eventPointer = useMemo(() => getHighlightSourceEventPointer(event), [event]);
const addressPointer = useMemo(() => getHighlightSourceAddressPointer(event), [event]);
const context = useMemo(() => getHighlightContext(event), [event]);

// AFTER - helpers cache internally
const highlightText = getHighlightText(event);
const sourceUrl = getHighlightSourceUrl(event);
const comment = getHighlightComment(event);
const eventPointer = getHighlightSourceEventPointer(event);
const addressPointer = getHighlightSourceAddressPointer(event);
const context = getHighlightContext(event);
```

#### 3. CodeSnippetDetailRenderer.tsx (lines 37-44)
```typescript
// BEFORE
const name = useMemo(() => getCodeName(event), [event]);
const language = useMemo(() => getCodeLanguage(event), [event]);
const extension = useMemo(() => getCodeExtension(event), [event]);
const description = useMemo(() => getCodeDescription(event), [event]);
const runtime = useMemo(() => getCodeRuntime(event), [event]);
const licenses = useMemo(() => getCodeLicenses(event), [event]);
const dependencies = useMemo(() => getCodeDependencies(event), [event]);
const repo = useMemo(() => getCodeRepo(event), [event]);

// AFTER - our custom helpers use getTagValue which caches
const name = getCodeName(event);
const language = getCodeLanguage(event);
const extension = getCodeExtension(event);
const description = getCodeDescription(event);
const runtime = getCodeRuntime(event);
const licenses = getCodeLicenses(event);
const dependencies = getCodeDependencies(event);
const repo = getCodeRepo(event);
```

#### 4. ChatView.tsx (lines 94, 96)
```typescript
// BEFORE
const threadRefs = useMemo(() => getNip10References(event), [event]);
const qTagValue = useMemo(() => getTagValue(event, "q"), [event]);

// AFTER - helpers cache internally
const threadRefs = getNip10References(event);
const qTagValue = getTagValue(event, "q");
```

#### 5. LiveActivityRenderer.tsx (lines 20-22)
```typescript
// BEFORE - if using applesauce helpers
const activity = useMemo(() => parseLiveActivity(event), [event]);
const status = useMemo(() => getLiveStatus(event), [event]);
const hostPubkey = useMemo(() => getLiveHost(event), [event]);

// AFTER - check if these use applesauce helpers internally
// If yes, remove useMemo. If no, keep as is.
```

**Note**: Check if `parseLiveActivity`, `getLiveStatus`, `getLiveHost` use applesauce helpers or implement caching themselves.

### MEDIUM PRIORITY: Use Applesauce Pointer Helpers

#### 1. ReactionRenderer.tsx - Replace manual coordinate parsing
```typescript
// BEFORE (lines 58-66)
const addressParts = useMemo(() => {
  if (!reactedAddress) return null;
  const parts = reactedAddress.split(":");
  return {
    kind: parseInt(parts[0], 10),
    pubkey: parts[1],
    dTag: parts[2],
  };
}, [reactedAddress]);

// AFTER - use parseCoordinate helper
import { parseCoordinate } from "applesauce-core/helpers";

const addressPointer = reactedAddress ? parseCoordinate(reactedAddress) : null;
// No useMemo needed - parseCoordinate is a simple function
```

#### 2. ReactionRenderer.tsx - Use reaction pointer helpers
```typescript
// CURRENT: Manual tag extraction
const reactedEventId = event.tags.find((t) => t[0] === "e")?.[1];
const reactedAddress = event.tags.find((t) => t[0] === "a")?.[1];

// POTENTIAL ALTERNATIVE: Use built-in helpers
import { getReactionEventPointer, getReactionAddressPointer } from "applesauce-core/helpers";

const eventPointer = getReactionEventPointer(event);
const addressPointer = getReactionAddressPointer(event);
```

**Trade-off**: Current code gets raw values, helpers return typed pointers. May require component changes. **Evaluate if worth it.**

### MEDIUM PRIORITY: Improve Filter Comparison

#### useStable.ts - Use isFilterEqual instead of JSON.stringify
```typescript
// BEFORE (lines 55-58)
export function useStableFilters<T>(filters: T): T {
  return useMemo(() => filters, [JSON.stringify(filters)]);
}

// AFTER - use isFilterEqual for comparison
import { isFilterEqual } from "applesauce-core/helpers";

export function useStableFilters<T>(filters: T): T {
  const prevFiltersRef = useRef<T>();

  if (!prevFiltersRef.current || !isFilterEqual(prevFiltersRef.current as any, filters as any)) {
    prevFiltersRef.current = filters;
  }

  return prevFiltersRef.current;
}
```

**Benefits**:
- More robust comparison (handles undefined values correctly)
- Avoids JSON serialization overhead
- Supports NIP-ND AND operator (`&` prefix)

**Note**: May need to handle non-filter types (arrays, objects).

### LOW PRIORITY: Code Organization

#### 1. Document applesauce caching in code comments
Add comments to custom helpers that use applesauce helpers:

```typescript
// nip34-helpers.ts
/**
 * Get the repository name from a repository event
 * Note: Uses applesauce getTagValue which caches internally
 * @param event Repository event (kind 30617)
 * @returns Repository name or undefined
 */
export function getRepositoryName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}
```

#### 2. Consider consolidating tag extraction
Since we use `getTagValue` extensively, ensure all single-tag extractions use it instead of manual `find()`:

```typescript
// PREFER
const value = getTagValue(event, "tagName");

// AVOID
const value = event.tags.find(t => t[0] === "tagName")?.[1];
```

## Testing Recommendations

1. **Test helper caching**: Verify applesauce helpers actually cache (call twice, ensure same reference)
2. **Performance testing**: Measure before/after removing useMemo (expect minimal change due to caching)
3. **Filter comparison**: Test `isFilterEqual` edge cases (undefined, empty arrays, NIP-ND AND operator)
4. **Pointer parsing**: Test `parseCoordinate` with various coordinate formats

## Migration Strategy

### Phase 1: Remove Unnecessary useMemo (Low Risk)
1. Remove useMemo from applesauce helper calls in kind renderers
2. Test rendering performance
3. Verify no issues
4. Commit

### Phase 2: Replace Pointer Parsing (Medium Risk)
1. Replace manual coordinate parsing with `parseCoordinate`
2. Update types if needed
3. Test reaction rendering
4. Commit

### Phase 3: Improve Filter Comparison (Medium Risk)
1. Implement `useStableFilters` with `isFilterEqual`
2. Test filter subscription behavior
3. Verify no unnecessary re-subscriptions
4. Commit

### Phase 4: Documentation (Low Risk)
1. Update CLAUDE.md with applesauce helper guidance
2. Add code comments documenting caching
3. Update skills if needed

## Questions to Investigate

1. **Do all our custom helpers cache?** Check `parseLiveActivity`, `getLiveStatus`, `getEventDisplayTitle`, etc.
2. **Should we create a shared cache util?** For custom helpers that don't use applesauce helpers underneath
3. **Is getTagValues used enough to add to applesauce?** Consider contributing upstream
4. **Filter aliases**: Could `resolveFilterAliases` be contributed to applesauce?

## Summary of Changes

| Category | Impact | Files Affected | Effort |
|----------|--------|----------------|--------|
| Remove useMemo from applesauce helpers | Performance (minor), Code clarity (major) | 8+ renderer files | Low |
| Use pointer helpers | Type safety, Code clarity | ReactionRenderer.tsx | Medium |
| Improve filter comparison | Correctness, Performance | useStable.ts | Medium |
| Documentation | Developer experience | CLAUDE.md, skills | Low |

**Total estimated effort**: 4-6 hours
**Risk level**: Low-Medium
**Expected benefits**: Cleaner code, better alignment with applesauce patterns, easier maintenance

## References

- [Applesauce Documentation](https://hzrd149.github.io/applesauce/)
- [Applesauce GitHub](https://github.com/hzrd149/applesauce)
- [Applesauce Core TypeDoc](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-core.html)
