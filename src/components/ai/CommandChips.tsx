import { AlertTriangle, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { useAddWindow } from "@/core/state";
import { proposeCommands, resolveCommand } from "@/lib/ai-commands";

/**
 * Commands a model proposed, as buttons the user presses.
 *
 * This is the no-tool-calling path, and the permanent fallback: it works on any
 * IPA implementation, needs no `tools` permission round, and cannot act on its
 * own. The model writes a command; the human decides it runs.
 */
export function CommandChips({ block }: { block: string }) {
  const addWindow = useAddWindow();
  const { pubkey } = useAccount();
  const [error, setError] = useState<string | null>(null);
  const proposed = proposeCommands(block);

  if (proposed.length === 0) return null;

  const run = async (command: string) => {
    setError(null);
    try {
      const resolved = await resolveCommand(command, pubkey);
      addWindow(
        resolved.appId,
        resolved.props,
        resolved.commandString,
        resolved.customTitle,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="my-2 space-y-1">
      {proposed.map((command) => (
        <div className="flex items-center gap-2" key={command.command}>
          <Button
            className="h-6 gap-1.5 px-2 font-mono text-xs"
            disabled={Boolean(command.refusal)}
            onClick={() => void run(command.command)}
            size="sm"
            title={command.refusal ?? `Run: ${command.command}`}
            type="button"
            variant="secondary"
          >
            {command.refusal ? (
              <AlertTriangle className="size-3" />
            ) : (
              <Play className="size-3" />
            )}
            {command.command}
          </Button>
          {command.refusal && (
            <span className="text-xs text-muted-foreground">
              {command.refusal}
            </span>
          )}
        </div>
      ))}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
