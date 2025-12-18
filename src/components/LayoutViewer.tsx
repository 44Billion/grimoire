import { useState } from "react";
import { useGrimoire } from "@/core/state";
import { getAllPresets } from "@/lib/layout-presets";
import type { LayoutPreset } from "@/lib/layout-presets";
import { Button } from "./ui/button";
import { Grid2X2, Columns2, Split, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface LayoutViewerProps {
  presetId?: string;
  error?: string;
}

/**
 * LAYOUT viewer - displays available layout presets and allows applying them
 */
export function LayoutViewer({ presetId, error }: LayoutViewerProps) {
  const { state, applyPresetLayout } = useGrimoire();
  const activeWorkspace = state.workspaces[state.activeWorkspaceId];
  const windowCount = activeWorkspace.windowIds.length;
  const presets = getAllPresets();
  const [applying, setApplying] = useState<string | null>(null);

  // If a preset was specified via command line, show error or success
  const specifiedPreset = presetId
    ? presets.find((p) => p.id === presetId)
    : null;

  const handleApplyPreset = async (preset: LayoutPreset) => {
    if (windowCount < preset.slots) {
      toast.error(`Not enough windows`, {
        description: `Preset "${preset.name}" requires ${preset.slots} windows, but only ${windowCount} available.`,
      });
      return;
    }

    setApplying(preset.id);
    try {
      applyPresetLayout(preset);
      toast.success(`Layout applied`, {
        description: `Applied "${preset.name}" preset to workspace ${activeWorkspace.number}`,
      });
    } catch (error) {
      toast.error(`Failed to apply layout`, {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setApplying(null);
    }
  };

  const getPresetIcon = (presetId: string) => {
    switch (presetId) {
      case "side-by-side":
        return <Columns2 className="h-8 w-8" />;
      case "main-sidebar":
        return <Split className="h-8 w-8" />;
      case "grid":
        return <Grid2X2 className="h-8 w-8" />;
      default:
        return <Grid2X2 className="h-8 w-8" />;
    }
  };

  const getPresetDiagram = (preset: LayoutPreset) => {
    // Visual representation of the layout
    switch (preset.id) {
      case "side-by-side":
        return (
          <div className="flex gap-2 h-16">
            <div className="flex-1 border-2 border-muted-foreground/30 rounded bg-muted/20" />
            <div className="flex-1 border-2 border-muted-foreground/30 rounded bg-muted/20" />
          </div>
        );
      case "main-sidebar":
        return (
          <div className="flex gap-2 h-16">
            <div className="flex-[7] border-2 border-muted-foreground/30 rounded bg-muted/20" />
            <div className="flex-[3] border-2 border-muted-foreground/30 rounded bg-muted/20" />
          </div>
        );
      case "grid":
        return (
          <div className="grid grid-cols-2 grid-rows-2 gap-2 h-16">
            <div className="border-2 border-muted-foreground/30 rounded bg-muted/20" />
            <div className="border-2 border-muted-foreground/30 rounded bg-muted/20" />
            <div className="border-2 border-muted-foreground/30 rounded bg-muted/20" />
            <div className="border-2 border-muted-foreground/30 rounded bg-muted/20" />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Layout Presets</h1>
          <p className="text-muted-foreground text-sm">
            Apply preset layouts to reorganize windows in workspace{" "}
            {activeWorkspace.number}
          </p>
          <div className="mt-2 text-sm">
            <span className="text-muted-foreground">Current windows: </span>
            <span className="font-semibold">{windowCount}</span>
          </div>
        </div>

        {/* Command-line specified preset with error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/50 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-destructive mb-1">
                Command Error
              </div>
              <div className="text-sm text-muted-foreground">{error}</div>
            </div>
          </div>
        )}

        {/* Command-line specified preset (valid) */}
        {specifiedPreset && !error && (
          <div className="mb-6 p-4 rounded-lg bg-accent/10 border border-accent/50 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-accent-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold mb-1">
                Preset: {specifiedPreset.name}
              </div>
              <div className="text-sm text-muted-foreground mb-3">
                {specifiedPreset.description}
              </div>
              {windowCount < specifiedPreset.slots ? (
                <div className="text-sm text-destructive">
                  ⚠️ Not enough windows (requires {specifiedPreset.slots}, have{" "}
                  {windowCount})
                </div>
              ) : (
                <Button
                  onClick={() => handleApplyPreset(specifiedPreset)}
                  size="sm"
                  disabled={applying === specifiedPreset.id}
                >
                  {applying === specifiedPreset.id
                    ? "Applying..."
                    : "Apply Preset"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Preset Gallery */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((preset) => {
            const canApply = windowCount >= preset.slots;
            const isApplying = applying === preset.id;

            return (
              <div
                key={preset.id}
                className={`p-4 rounded-lg border transition-colors ${
                  canApply
                    ? "border-border hover:border-accent/50 hover:bg-accent/5"
                    : "border-muted-foreground/20 opacity-60"
                }`}
              >
                {/* Icon and Title */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-muted-foreground">
                    {getPresetIcon(preset.id)}
                  </div>
                  <div>
                    <div className="font-semibold">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {preset.slots} windows
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground mb-3">
                  {preset.description}
                </p>

                {/* Visual Diagram */}
                <div className="mb-3">{getPresetDiagram(preset)}</div>

                {/* Apply Button */}
                {canApply ? (
                  <Button
                    onClick={() => handleApplyPreset(preset)}
                    className="w-full"
                    variant="outline"
                    size="sm"
                    disabled={isApplying}
                  >
                    {isApplying ? "Applying..." : "Apply"}
                  </Button>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    Requires {preset.slots} windows (have {windowCount})
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
