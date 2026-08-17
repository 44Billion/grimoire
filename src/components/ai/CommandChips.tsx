import { AlertTriangle, Play } from "lucide-react";
import { useState } from "react";

import { useAccount } from "@/hooks/useAccount";
import { useAddWindow } from "@/core/state";
import { proposeCommands, resolveCommand } from "@/lib/ai-commands";

import "../command-launcher.css";

/**
 * Commands a model proposed, as rows the user presses.
 *
 * This is the no-tool-calling path, and the permanent fallback: it works on any
 * IPA implementation, needs no `tools` permission round, and cannot act on its
 * own. The model writes a command; the human decides it runs.
 *
 * Styled with the palette's own classes so a proposed command looks like the
 * same command typed at Cmd+K, and follows the palette if that restyles.
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
    <div className="my-3 overflow-hidden rounded border border-border">
      {proposed.map((command) => (
        <button
          className="command-item block w-full text-left"
          disabled={Boolean(command.refusal)}
          key={command.command}
          onClick={() => void run(command.command)}
          title={command.refusal ?? `Run: ${command.command}`}
          type="button"
        >
          <div className="command-item-content">
            <div className="command-item-name">
              {command.refusal ? (
                <AlertTriangle className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <Play className="size-3 shrink-0" />
              )}
              <span className="command-name">{command.name}</span>
              {command.args && (
                <span className="command-args">{command.args}</span>
              )}
            </div>
            <div className="command-item-description">
              {command.refusal ?? command.description}
            </div>
          </div>
        </button>
      ))}
      {error && (
        <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
