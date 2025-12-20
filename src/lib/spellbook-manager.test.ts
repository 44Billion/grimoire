import { describe, it, expect } from "vitest";
import {
  createSpellbook,
  parseSpellbook,
  loadSpellbook,
  slugify,
} from "./spellbook-manager";
import { GrimoireState, WindowInstance, Workspace } from "@/types/app";
import { SPELLBOOK_KIND, SpellbookEvent } from "@/types/spell";

// Mock Data
const mockWindow1: WindowInstance = {
  id: "win-1",
  appId: "profile",
  props: { pubkey: "abc" },
  spellId: "spell-1",
};

const mockWindow2: WindowInstance = {
  id: "win-2",
  appId: "kind",
  props: { kind: 1 },
};

const mockWorkspace1: Workspace = {
  id: "ws-1",
  number: 1,
  layout: "win-1",
  windowIds: ["win-1"],
};

const mockWorkspace2: Workspace = {
  id: "ws-2",
  number: 2,
  layout: {
    direction: "row",
    first: "win-2",
    second: "win-1",
  },
  windowIds: ["win-1", "win-2"],
};

const mockState: GrimoireState = {
  __version: 6,
  windows: {
    "win-1": mockWindow1,
    "win-2": mockWindow2,
  },
  workspaces: {
    "ws-1": mockWorkspace1,
    "ws-2": mockWorkspace2,
  },
  activeWorkspaceId: "ws-1",
  layoutConfig: {
    insertionMode: "smart",
    splitPercentage: 50,
    insertionPosition: "second",
  },
};

describe("Spellbook Manager", () => {
  describe("slugify", () => {
    it("converts titles to slugs", () => {
      expect(slugify("Hello World")).toBe("hello-world");
      expect(slugify("My Cool Dashboard!")).toBe("my-cool-dashboard");
      expect(slugify("  Trim Me  ")).toBe("trim-me");
      expect(slugify("Mixed Case Title")).toBe("mixed-case-title");
    });
  });

  describe("createSpellbook", () => {
    it("creates a valid spellbook from state", () => {
      const result = createSpellbook({
        state: mockState,
        title: "My Backup",
        description: "Test description",
        workspaceIds: ["ws-1"],
      });

      const { eventProps, referencedSpells } = result;
      const content = JSON.parse(eventProps.content);

      // Check event props
      expect(eventProps.kind).toBe(SPELLBOOK_KIND);
      expect(eventProps.tags).toContainEqual(["d", "my-backup"]);
      expect(eventProps.tags).toContainEqual(["title", "My Backup"]);
      expect(eventProps.tags).toContainEqual(["description", "Test description"]);
      expect(eventProps.tags).toContainEqual(["client", "grimoire"]);
      
      // Check referenced spells (e tags)
      expect(referencedSpells).toContain("spell-1");
      expect(eventProps.tags).toContainEqual(["e", "spell-1", "", "mention"]);

      // Check content structure
      expect(content.version).toBe(1);
      expect(Object.keys(content.workspaces)).toHaveLength(1);
      expect(content.workspaces["ws-1"]).toBeDefined();
      
      // Should only include windows referenced in the workspace
      expect(Object.keys(content.windows)).toHaveLength(1);
      expect(content.windows["win-1"]).toBeDefined();
      expect(content.windows["win-2"]).toBeUndefined();
    });

    it("includes all workspaces if no IDs provided", () => {
      const result = createSpellbook({
        state: mockState,
        title: "Full Backup",
      });

      const content = JSON.parse(result.eventProps.content);
      expect(Object.keys(content.workspaces)).toHaveLength(2);
      expect(Object.keys(content.windows)).toHaveLength(2);
    });
  });

  describe("parseSpellbook", () => {
    it("parses a valid spellbook event", () => {
      const content = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const event: SpellbookEvent = {
        id: "evt-1",
        pubkey: "pub-1",
        created_at: 123456,
        kind: SPELLBOOK_KIND,
        tags: [
          ["d", "my-slug"],
          ["title", "My Title"],
          ["description", "Desc"],
          ["e", "spell-1"],
        ],
        content: JSON.stringify(content),
        sig: "sig",
      };

      const parsed = parseSpellbook(event);

      expect(parsed.slug).toBe("my-slug");
      expect(parsed.title).toBe("My Title");
      expect(parsed.description).toBe("Desc");
      expect(parsed.content).toEqual(content);
      expect(parsed.referencedSpells).toContain("spell-1");
    });

    it("handles parsing errors gracefully", () => {
      const event = {
        kind: SPELLBOOK_KIND,
        content: "invalid json",
        tags: [],
      } as any;

      expect(() => parseSpellbook(event)).toThrow("Failed to parse spellbook content");
    });
  });

  describe("loadSpellbook", () => {
    it("imports workspaces with new IDs and numbers", () => {
      const spellbookContent = {
        version: 1,
        workspaces: { "ws-1": mockWorkspace1 },
        windows: { "win-1": mockWindow1 },
      };

      const parsed = {
        slug: "test",
        title: "Test",
        content: spellbookContent,
        referencedSpells: [],
        event: {} as any,
      };

      // State has workspaces 1 and 2 used. Next available should be 3.
      const newState = loadSpellbook(mockState, parsed);

      // Should have 3 workspaces now (2 original + 1 imported)
      expect(Object.keys(newState.workspaces)).toHaveLength(3);

      // Find the new workspace
      const newWsEntry = Object.entries(newState.workspaces).find(
        ([id]) => id !== "ws-1" && id !== "ws-2"
      );
      
      expect(newWsEntry).toBeDefined();
      const [newId, newWs] = newWsEntry!;
      
      // IDs should be regenerated
      expect(newId).not.toBe("ws-1");
      expect(newWs.id).not.toBe("ws-1");
      
      // Number should be 3 (lowest available)
      expect(newWs.number).toBe(3);
      
      // Window IDs should be regenerated
      const newWinId = newWs.windowIds[0];
      expect(newWinId).not.toBe("win-1");
      expect(newState.windows[newWinId]).toBeDefined();
      expect(newState.windows[newWinId].appId).toBe("profile");
      
      // Layout should reference new window ID
      expect(newWs.layout).toBe(newWinId);
    });

    it("updates layout tree with new window IDs", () => {
        const spellbookContent = {
            version: 1,
            workspaces: { "ws-2": mockWorkspace2 },
            windows: { "win-1": mockWindow1, "win-2": mockWindow2 },
        };

        const parsed = {
            slug: "test",
            title: "Test",
            content: spellbookContent,
            referencedSpells: [],
            event: {} as any,
        };

        const newState = loadSpellbook(mockState, parsed);
        const newWs = Object.values(newState.workspaces).find(w => w.number === 3)!;
        
        expect(typeof newWs.layout).toBe("object");
        if (typeof newWs.layout === "object" && newWs.layout !== null) {
            // Check that leaf nodes are new UUIDs, not old IDs
            expect(newWs.layout.first).not.toBe("win-2");
            expect(newWs.layout.second).not.toBe("win-1");
            
            // Check that they match the windowIds list
            expect(newWs.windowIds).toContain(newWs.layout.first);
            expect(newWs.windowIds).toContain(newWs.layout.second);
        }
    });
  });
});
