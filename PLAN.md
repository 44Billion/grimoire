# Plan: Pluggable Storage Engine for Test Compatibility

## Problem Summary

The test suite fails in Node.js because:
- 10 tests in `spellbook-storage.test.ts` fail with `MissingAPIError: IndexedDB API missing`
- Services like `relay-liveness.ts` and `relay-list-cache.ts` show IndexedDB errors (but handle them gracefully)
- The `db.ts` singleton directly uses Dexie/IndexedDB which isn't available in Node

## Options Analysis

### Option A: Polyfill IndexedDB with `fake-indexeddb` (Recommended)

**Approach**: Use `fake-indexeddb` package to provide IndexedDB API in Node tests.

**Pros**:
- Minimal code changes (just vitest setup)
- Tests actual Dexie code paths accurately
- One-time setup, zero maintenance
- Dexie officially supports this approach

**Cons**:
- Not truly "pluggable" - still coupled to Dexie
- Tests slightly slower than pure in-memory

**Effort**: ~30 minutes

---

### Option B: Full Pluggable Storage Interface

**Approach**: Abstract all storage operations behind interfaces, implement both DexieStorage and InMemoryStorage.

**Pros**:
- True flexibility - swap storage backends
- Faster tests with pure in-memory implementation
- Could support alternative backends (SQLite, etc.)

**Cons**:
- Significant refactoring (~11 files)
- More code to maintain
- Need to handle `useLiveQuery` hook differently (Dexie-specific)
- Adds complexity for marginal benefit

**Effort**: ~4-6 hours

---

### Option C: Hybrid Approach

**Approach**: Use `fake-indexeddb` for now, extract storage interfaces incrementally where it matters.

**Pros**:
- Immediate fix with minimal effort
- Can evolve architecture as needed
- Best of both worlds

**Effort**: ~30 minutes initial + incremental

---

## Recommended Plan: Option A (with Option C path forward)

### Step 1: Install fake-indexeddb

```bash
npm install -D fake-indexeddb
```

### Step 2: Create vitest setup file

Create `src/test/setup.ts`:

```typescript
import "fake-indexeddb/auto";
```

### Step 3: Update vitest config

Update `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
  // ...
});
```

### Step 4: Verify tests pass

```bash
npm run test:run
```

### Step 5 (Optional): Add database reset helper

Create `src/test/db-helpers.ts` for consistent test cleanup:

```typescript
import db from "@/services/db";

export async function clearTestDatabase() {
  await Promise.all([
    db.profiles.clear(),
    db.nip05.clear(),
    db.nips.clear(),
    db.relayInfo.clear(),
    db.relayAuthPreferences.clear(),
    db.relayLists.clear(),
    db.relayLiveness.clear(),
    db.spells.clear(),
    db.spellbooks.clear(),
  ]);
}
```

---

## Future: Evolving to Pluggable Storage (Option B details)

If you later want true pluggability, here's how:

### 1. Define Storage Interface

```typescript
// src/storage/types.ts
export interface SpellbookStorage {
  save(spellbook: Omit<LocalSpellbook, "id" | "createdAt">): Promise<LocalSpellbook>;
  get(id: string): Promise<LocalSpellbook | undefined>;
  getAll(): Promise<LocalSpellbook[]>;
  delete(id: string): Promise<void>;
  markPublished(id: string, event: SpellbookEvent): Promise<void>;
}
```

### 2. Create Implementations

- `src/storage/dexie/spellbook-storage.ts` - Current Dexie implementation
- `src/storage/memory/spellbook-storage.ts` - In-memory for tests

### 3. Use Context/DI

```typescript
// src/storage/context.ts
export const StorageContext = createContext<Storage>(dexieStorage);

// In tests
<StorageContext.Provider value={memoryStorage}>
```

### 4. Handle useLiveQuery

The `useLiveQuery` hook is Dexie-specific. Options:
- Create `useStorageQuery` abstraction with observable pattern
- Keep useLiveQuery for components, mock storage layer for unit tests
- Use integration tests with fake-indexeddb for component testing

---

## Files Affected

### Option A (Minimal):
- `vitest.config.ts` - Add setupFiles
- `src/test/setup.ts` - New file (2 lines)
- `package.json` - Add fake-indexeddb dev dependency

### Option B (Full refactor):
- `src/services/db.ts`
- `src/services/spell-storage.ts`
- `src/services/spellbook-storage.ts`
- `src/services/relay-state-manager.ts`
- `src/services/relay-list-cache.ts`
- `src/services/relay-liveness.ts`
- `src/lib/nip11.ts`
- `src/hooks/useNip.ts`
- `src/hooks/useNip05.ts`
- `src/hooks/useProfile.ts`
- `src/hooks/useRelayInfo.ts`
- Plus 5 component files using useLiveQuery

---

## My Recommendation

**Start with Option A**. It's the pragmatic choice:
1. Fixes tests immediately
2. Tests actual production code paths
3. Dexie's maintainers recommend this approach
4. You can always evolve to Option B later if needed

The "pluggable storage" architecture (Option B) is valuable when:
- You need to support multiple storage backends in production
- You want ultra-fast unit tests (~100 tests in <100ms)
- You're building a library others will use

For a Nostr app like Grimoire, `fake-indexeddb` gives you the testing capability without the complexity overhead.
