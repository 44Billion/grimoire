import { describe, it, expect, beforeEach } from "vitest";
import { firstValueFrom } from "rxjs";
import {
  listLoaded$,
  markListLoaded,
  resetListSyncState,
} from "./list-sync-state";

describe("list-sync-state", () => {
  beforeEach(() => resetListSyncState());

  it("tracks completion per kind and pubkey", async () => {
    expect(await firstValueFrom(listLoaded$(3, "a"))).toBe(false);
    markListLoaded(3, "a");
    expect(await firstValueFrom(listLoaded$(3, "a"))).toBe(true);
    expect(await firstValueFrom(listLoaded$(3, "b"))).toBe(false);
    expect(await firstValueFrom(listLoaded$(10002, "a"))).toBe(false);
  });
});
