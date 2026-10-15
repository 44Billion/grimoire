/**
 * A zap amount inline: yellow bolt and a compact number, sized to sit in a
 * one-line preview beside text-xs copy.
 */

import { Zap } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

export function ZapAmountInline({ sats }: { sats: number }) {
  const { locale } = useLocale();
  return (
    <span className="inline-flex items-center gap-1 self-center text-yellow-500 font-semibold flex-shrink-0">
      <Zap className="size-3.5 fill-yellow-500" />
      <span className="text-sm leading-none">
        {sats.toLocaleString(locale, { notation: "compact" })}
      </span>
    </span>
  );
}
