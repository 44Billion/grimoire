import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useGrimoire } from "@/core/state";
import { manPages } from "@/types/man";
import "./command-launcher.css";

interface CommandLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandLauncher({
  open,
  onOpenChange,
}: CommandLauncherProps) {
  const [input, setInput] = useState("");
  const { addWindow } = useGrimoire();

  useEffect(() => {
    if (!open) {
      setInput("");
    }
  }, [open]);

  // Parse input into command and arguments
  const parseInput = (value: string) => {
    const parts = value.trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase() || "";
    const args = parts.slice(1);
    return { commandName, args, fullInput: value };
  };

  const { commandName, args } = parseInput(input);
  const recognizedCommand = commandName && manPages[commandName];

  // Filter commands by partial match on command name only
  const filteredCommands = Object.entries(manPages).filter(([name]) =>
    name.toLowerCase().includes(commandName.toLowerCase()),
  );

  // Execute command (async to support async argParsers)
  const executeCommand = async () => {
    if (!recognizedCommand) return;

    const command = recognizedCommand;

    // Use argParser if available, otherwise use defaultProps
    // argParser can now be async
    const props = command.argParser
      ? await Promise.resolve(command.argParser(args))
      : command.defaultProps || {};

    // Generate title
    const title =
      args.length > 0
        ? `${commandName.toUpperCase()} ${args.join(" ")}`
        : commandName.toUpperCase();

    // Execute command
    addWindow(command.appId, props, title);
    onOpenChange(false);
  };

  // Handle item selection (populate input, don't execute)
  const handleSelect = (selectedCommand: string) => {
    setInput(selectedCommand + " ");
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand();
    }
  };

  // Define category order: Nostr first, then Documentation, then System
  const categoryOrder = ["Nostr", "Documentation", "System"];
  const categories = Array.from(
    new Set(filteredCommands.map(([_, cmd]) => cmd.category)),
  ).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  // Dynamic placeholder
  const placeholder = recognizedCommand
    ? recognizedCommand.synopsis
    : "Type a command...";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command Launcher"
      className="grimoire-command-launcher"
      shouldFilter={false}
    >
      <div className="command-launcher-wrapper">
        <Command.Input
          value={input}
          onValueChange={setInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="command-input"
        />

        {recognizedCommand && args.length > 0 && (
          <div className="command-hint">
            <span className="command-hint-label">Parsed:</span>
            <span className="command-hint-command">{commandName}</span>
            <span className="command-hint-args">{args.join(" ")}</span>
          </div>
        )}

        <Command.List className="command-list">
          <Command.Empty className="command-empty">
            {commandName
              ? `No command found: ${commandName}`
              : "Start typing..."}
          </Command.Empty>

          {categories.map((category) => (
            <Command.Group
              key={category}
              heading={category}
              className="command-group"
            >
              {filteredCommands
                .filter(([_, cmd]) => cmd.category === category)
                .map(([name, cmd]) => {
                  const isExactMatch = name === commandName;
                  return (
                    <Command.Item
                      key={name}
                      value={name}
                      onSelect={() => handleSelect(name)}
                      className="command-item"
                      data-exact-match={isExactMatch}
                    >
                      <div className="command-item-content">
                        <div className="command-item-name">
                          <span className="command-name">{name}</span>
                          {cmd.synopsis !== name && (
                            <span className="command-args">
                              {cmd.synopsis.replace(name, "").trim()}
                            </span>
                          )}
                          {isExactMatch && (
                            <span className="command-match-indicator">✓</span>
                          )}
                        </div>
                        <div className="command-item-description">
                          {cmd.description.split(".")[0]}
                        </div>
                      </div>
                    </Command.Item>
                  );
                })}
            </Command.Group>
          ))}
        </Command.List>

        <div className="command-footer">
          <div>
            <kbd>↑↓</kbd> navigate
            <kbd>↵</kbd> execute
            <kbd>esc</kbd> close
          </div>
          {recognizedCommand && (
            <div className="command-footer-status">Ready to execute</div>
          )}
        </div>
      </div>
    </Command.Dialog>
  );
}
