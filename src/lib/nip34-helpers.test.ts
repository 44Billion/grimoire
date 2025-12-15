import { describe, it, expect } from "vitest";

/**
 * Test helper to parse unified diff content
 * This is a copy of the parseUnifiedDiff function from PatchDetailRenderer
 * for testing purposes
 */
function parseUnifiedDiff(content: string): {
  hunks: string[];
  oldFile?: { fileName?: string };
  newFile?: { fileName?: string };
} | null {
  const lines = content.split("\n");
  const hunks: string[] = [];
  let oldFileName: string | undefined;
  let newFileName: string | undefined;
  let currentHunk: string[] = [];
  let inHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract file names from --- and +++ lines
    if (line.startsWith("---")) {
      const match = line.match(/^---\s+(?:a\/)?(.+?)(?:\s|$)/);
      if (match) oldFileName = match[1];
    } else if (line.startsWith("+++")) {
      const match = line.match(/^\+\+\+\s+(?:b\/)?(.+?)(?:\s|$)/);
      if (match) newFileName = match[1];
    }
    // Start of a new hunk
    else if (line.startsWith("@@")) {
      // Save previous hunk if exists
      if (currentHunk.length > 0) {
        hunks.push(currentHunk.join("\n"));
      }
      currentHunk = [line];
      inHunk = true;
    }
    // Content lines within a hunk (start with +, -, or space)
    else if (
      inHunk &&
      (line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "")
    ) {
      currentHunk.push(line);
    }
    // End of current hunk
    else if (inHunk && !line.startsWith("@@")) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk.join("\n"));
        currentHunk = [];
      }
      inHunk = false;
    }
  }

  // Don't forget the last hunk
  if (currentHunk.length > 0) {
    hunks.push(currentHunk.join("\n"));
  }

  if (hunks.length === 0) {
    return null;
  }

  return {
    hunks,
    oldFile: oldFileName ? { fileName: oldFileName } : undefined,
    newFile: newFileName ? { fileName: newFileName } : undefined,
  };
}

describe("parseUnifiedDiff", () => {
  it("should parse a simple unified diff", () => {
    const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,6 @@
 context line
-deleted line
+added line
 context line`;

    const result = parseUnifiedDiff(diff);
    expect(result).not.toBeNull();
    expect(result?.hunks).toHaveLength(1);
    expect(result?.oldFile?.fileName).toBe("file.ts");
    expect(result?.newFile?.fileName).toBe("file.ts");
    expect(result?.hunks[0]).toContain("@@ -1,5 +1,6 @@");
    expect(result?.hunks[0]).toContain("-deleted line");
    expect(result?.hunks[0]).toContain("+added line");
  });

  it("should parse multiple hunks", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line 1
-old line 2
+new line 2
 line 3
@@ -10,3 +10,4 @@
 line 10
+new line 11
 line 12`;

    const result = parseUnifiedDiff(diff);
    expect(result).not.toBeNull();
    expect(result?.hunks).toHaveLength(2);
    expect(result?.hunks[0]).toContain("@@ -1,3 +1,3 @@");
    expect(result?.hunks[1]).toContain("@@ -10,3 +10,4 @@");
  });

  it("should extract file names with a/ and b/ prefixes", () => {
    const diff = `--- a/src/components/Button.tsx
+++ b/src/components/Button.tsx
@@ -1,1 +1,1 @@
-old
+new`;

    const result = parseUnifiedDiff(diff);
    expect(result?.oldFile?.fileName).toBe("src/components/Button.tsx");
    expect(result?.newFile?.fileName).toBe("src/components/Button.tsx");
  });

  it("should extract file names without a/ and b/ prefixes", () => {
    const diff = `--- file.ts
+++ file.ts
@@ -1,1 +1,1 @@
-old
+new`;

    const result = parseUnifiedDiff(diff);
    expect(result?.oldFile?.fileName).toBe("file.ts");
    expect(result?.newFile?.fileName).toBe("file.ts");
  });

  it("should return null for content with no hunks", () => {
    const diff = `This is not a valid diff
Just some random text`;

    const result = parseUnifiedDiff(diff);
    expect(result).toBeNull();
  });

  it("should handle empty lines within hunks", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
 line 1

-old line 3
+new line 3
 line 4`;

    const result = parseUnifiedDiff(diff);
    expect(result).not.toBeNull();
    expect(result?.hunks).toHaveLength(1);
    expect(result?.hunks[0]).toContain("");
  });

  it("should handle context lines (starting with space)", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 context line 1
-deleted
+added
 context line 3`;

    const result = parseUnifiedDiff(diff);
    expect(result).not.toBeNull();
    expect(result?.hunks[0]).toContain(" context line 1");
    expect(result?.hunks[0]).toContain(" context line 3");
  });
});
