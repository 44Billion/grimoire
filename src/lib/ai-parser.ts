export interface AiCommandProps {
  prompt?: string;
  system?: string;
}

/**
 * `ai [--system <text>] [prompt...]`
 *
 * Global flags (`--title`) are stripped before this runs. Everything left over
 * that is not consumed by `--system` becomes the prompt.
 */
export function parseAiCommand(args: string[]): AiCommandProps {
  const rest: string[] = [];
  let system: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--system" || arg === "-s") {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error("--system requires a value");
      }
      system = value;
      i++;
      continue;
    }
    rest.push(arg);
  }

  const prompt = rest.join(" ").trim();
  return {
    ...(prompt ? { prompt } : {}),
    ...(system ? { system } : {}),
  };
}
