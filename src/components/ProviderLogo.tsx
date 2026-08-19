/**
 * A model provider's mark.
 *
 * Same source the `ai` window's model selector uses — models.dev's logo set —
 * and same technique: the SVG is a CSS MASK rather than an `<img>`, so the mark
 * takes `currentColor` and sits in a line of text at whatever weight the text
 * around it has. A provider that has no logo there simply renders nothing, which
 * is the correct outcome: an unknown provider should cost a reader nothing.
 *
 * It is one request to one static path with no identifiers in it. That is the
 * same trade the model selector already makes; if it ever becomes unacceptable,
 * the fix is a local sprite, in one place, for both windows.
 */

import { cn } from "@/lib/utils";

/** Normalise what a transcript carries into a models.dev slug. */
function slugFor(provider: string): string {
  const lower = provider.toLowerCase();
  // `google-vertex-anthropic` and friends are their own slugs upstream, so only
  // the obvious aliases are folded.
  if (lower === "claude") return "anthropic";
  if (lower === "gpt" || lower === "chatgpt") return "openai";
  if (lower === "gemini") return "google";
  return lower;
}

export function ProviderLogo({
  provider,
  className,
}: {
  provider?: string;
  className?: string;
}) {
  if (!provider) return null;
  const slug = slugFor(provider);
  const url = `https://models.dev/logos/${encodeURIComponent(slug)}.svg`;

  return (
    <span
      aria-label={`${provider} logo`}
      role="img"
      className={cn("inline-block h-3 w-3 shrink-0 bg-current", className)}
      style={{
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
