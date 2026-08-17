import { parseAiTarget, type AiTarget } from "./ai-context";

export interface AiCommandProps {
  prompt?: string;
  system?: string;
  /** Object the question is about; its own data becomes the system prompt. */
  target?: AiTarget;
}

/**
 * `ai [--system <text>] [target] [prompt...]`
 *
 * A leading bech32 entity, kind number, or `nip-XX` is taken as the target —
 * the thing being asked about — and the rest is the question. Global flags
 * (`--title`) are stripped before this runs.
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

  // Only the first word can be a target, so a question that merely mentions an
  // npub stays a question.
  const target = rest.length > 0 ? parseAiTarget(rest[0]) : undefined;
  const words = target ? rest.slice(1) : rest;
  const prompt = words.join(" ").trim();

  return {
    ...(prompt ? { prompt } : {}),
    ...(system ? { system } : {}),
    ...(target ? { target } : {}),
  };
}
