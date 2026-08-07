Sync NIP and event kind definitions with the upstream nostr-protocol/nips repository.

## Step 1: Fetch upstream data

```bash
curl -s https://raw.githubusercontent.com/nostr-protocol/nips/master/README.md
```

Parse two sections from the README:

1. **List** — a bullet list, e.g. `- [NIP-01: Basic protocol flow description](01.md)`
   - Extract: NIP identifier from the link target (`01`, `7D`), title after the colon
   - There is no status column. Deprecation is a struck-through row:
     `- ~~[NIP-04: …](04.md) --- **unrecommended**: …~~`
2. **Event Kinds table** — rows like ``| `0` | User Metadata | [01](01.md) |``
   - Kind numbers are backticked; a regex that omits the backticks matches nothing
   - Extract: kind number, description, NIP reference
   - Ranges (`` `1630`-`1633` ``, `` `9000`-`9030` ``, `39000-9`) are categories — do
     NOT expand into individual entries

## Step 2: Update `src/constants/nips.ts`

Read the current file, then:

### VALID_NIPS array
- Add new NIP identifiers found upstream
- Remove NIPs no longer listed upstream (unless referenced by a kind in `kinds.ts`)
- Maintain sort order: numeric first (`"01"`–`"99"`), then hexadecimal (`"5A"`, `"7D"`, `"A0"`, etc.)
- Preserve the `// Numeric NIPs` and `// Hexadecimal NIPs` section comments

### NIP_TITLES record
- Add entries for new NIPs
- Update titles that changed upstream
- Keep existing entries that still match

### DEPRECATED_NIPS array
- Sync with upstream: add NIPs marked `unrecommended`/`deprecated`, remove ones no longer deprecated
- Keep `as const` assertion

## Step 3: Update `src/lib/nip-icons.ts`

Read the current file. The `NIP_METADATA` record provides icons, short names, and descriptions for each NIP — used by NIPBadge and NipsViewer.

### For every new NIP added in Step 2:
- Add a corresponding entry to `NIP_METADATA` with: `id` (string, matches the NIP identifier), `name` (short), `description`, `icon` (lucide-react), and `deprecated` if applicable
- All keys and `id` values are strings (e.g., `"01"`, `"5A"`, `"A0"`)
- Pick an icon from existing imports; add new imports if needed
- Place in correct position (numeric keys first, then hex keys sorted)

### For deprecated status changes:
- Add or remove the `deprecated: true` field to match upstream

### Preserve existing entries:
- Never change icons on existing entries
- Only update name/description if upstream changed

## Step 4: Update `src/constants/kinds.ts`

Read the current file, then apply changes carefully.

### PROTECTED — never modify or remove:
- **Grimoire custom kinds**: 777, 10777, 30777 — identified by `nip: ""`
- **Other custom kinds with `nip: ""`**: e.g., 32267, 34139, 36787
- **Community NIPs**: any entry with `communityNip` field (e.g., 30142)
- **Commented-out external specs**: Marmot, NKBIP, nostrocket, Corny Chat, Lightning.Pub, Nostr Epoxy, Tidal, joinstr, etc. Uncomment a block only when its spec graduates to a real NIP — geocaching did (NIP-CC) and Blossom did (NIP-B7), both now active. Say so in the report.
- **All existing `icon` assignments** — never change icons on existing entries
- **Section comments**: `// Core protocol kinds`, `// Lists`, `// Channels`, etc.

### Adding new kinds:
- Add individually-listed kind numbers from the upstream Event Kinds table
- Place in correct position by kind number (follow existing ordering)
- Pick an appropriate lucide-react icon from the existing imports at the top of the file
- If no existing import fits, add a new import and explain the choice
- Match the existing code style and format

### Updating existing kinds:
- If upstream name/description changed, update `name` and `description`
- If the NIP reference changed, update the `nip` field
- **Never** change the `icon` field on existing entries

## Step 5: Cross-reference validation

- Every `nip` field in `EVENT_KINDS` should exist in `VALID_NIPS` (except empty strings `""` and external or not-yet-merged specs like `"AMB"`, `"Marmot"`, `"5C"`)
- Every NIP in `DEPRECATED_NIPS` should also be in `VALID_NIPS`
- Every NIP in `VALID_NIPS` should have a corresponding entry in `NIP_METADATA` (`src/lib/nip-icons.ts`)
- Flag and fix any inconsistencies

## Step 6: Verify

```bash
npm run lint && npm run test:run && npm run build
```

Fix any lint/type/build issues before reporting.

## Step 7: Report

Summarize:
- NIPs added / removed / title-updated
- NIP icons added / updated in `nip-icons.ts`
- Kinds added / updated (with icon choices explained for new ones)
- Inconsistencies found and resolved
- Verification results (lint/test/build)
