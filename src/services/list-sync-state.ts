import { BehaviorSubject } from "rxjs";
import { map, distinctUntilChanged } from "rxjs/operators";
import type { Observable } from "rxjs";

/**
 * Which of the active user's replaceable lists have been fetched from relays
 * at least once this session.
 *
 * A list-editing hook starts from the event in the EventStore. If the event is
 * simply not loaded yet, "no event" and "the user has no list" look the same,
 * and writing from an empty base would overwrite a contact list or relay list
 * with a single entry. Loaders mark completion here so the hooks can tell the
 * two apart: a missing list may be created only after its loader completed.
 */
const loaded$ = new BehaviorSubject<ReadonlySet<string>>(new Set());

const key = (kind: number, pubkey: string) => `${kind}:${pubkey}`;

export function markListLoaded(kind: number, pubkey: string): void {
  const k = key(kind, pubkey);
  if (loaded$.value.has(k)) return;
  loaded$.next(new Set([...loaded$.value, k]));
}

export function listLoaded$(kind: number, pubkey: string): Observable<boolean> {
  const k = key(kind, pubkey);
  return loaded$.pipe(
    map((set) => set.has(k)),
    distinctUntilChanged(),
  );
}

/** Test hook: forget every mark. */
export function resetListSyncState(): void {
  loaded$.next(new Set());
}
