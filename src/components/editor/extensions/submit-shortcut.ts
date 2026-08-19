import { Extension } from "@tiptap/core";
import type { MutableRefObject } from "react";
import type { Editor } from "@tiptap/core";

interface SubmitShortcutOptions {
  /** Ref to the submit handler (uses ref to avoid stale closures) */
  submitRef: MutableRefObject<(editor: Editor) => void>;
  /** If true, plain Enter submits (desktop chat). If false, Enter creates newline (rich editor / mobile). */
  enterSubmits: boolean;
}

/**
 * Keyboard shortcut extension for editor submission
 *
 * - Ctrl/Cmd+Enter always submits
 * - Plain Enter behavior depends on `enterSubmits` option:
 *   - true (desktop chat): Enter submits, Shift+Enter inserts newline
 *   - false (rich editor / mobile): Enter creates newline normally
 */
export const SubmitShortcut = Extension.create<SubmitShortcutOptions>({
  name: "submitShortcut",

  addOptions() {
    return {
      submitRef: { current: () => {} } as MutableRefObject<
        (editor: Editor) => void
      >,
      enterSubmits: false,
    };
  },

  addKeyboardShortcuts() {
    const submit = () => {
      this.options.submitRef.current(this.editor);
      return true;
    };

    // Both, deliberately: `Mod` is Cmd on macOS, so Ctrl+Enter — what anyone
    // arriving from a terminal or another chat client presses — did nothing
    // there at all.
    const shortcuts: Record<string, () => boolean> = {
      "Mod-Enter": submit,
      "Ctrl-Enter": submit,
    };

    if (this.options.enterSubmits) {
      shortcuts["Enter"] = submit;
    }

    return shortcuts;
  },
});
