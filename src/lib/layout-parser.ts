import { getPreset, getAllPresets } from "./layout-presets";

export interface LayoutCommandResult {
  /** The preset ID to apply, or undefined to show preset list */
  presetId?: string;
  /** Error message if parsing failed */
  error?: string;
}

/**
 * Parses the /layout command arguments
 *
 * Usage:
 *   /layout              - Show all available presets
 *   /layout side-by-side - Apply the side-by-side preset
 *   /layout grid         - Apply the grid preset
 */
export function parseLayoutCommand(args: string[]): LayoutCommandResult {
  // No arguments - show preset list
  if (args.length === 0) {
    return {};
  }

  // Get the preset ID (first argument)
  const presetId = args[0].toLowerCase();

  // Validate preset exists
  const preset = getPreset(presetId);
  if (!preset) {
    const availablePresets = getAllPresets()
      .map((p) => p.id)
      .join(", ");
    return {
      error: `Unknown preset "${presetId}". Available presets: ${availablePresets}`,
    };
  }

  return { presetId };
}
