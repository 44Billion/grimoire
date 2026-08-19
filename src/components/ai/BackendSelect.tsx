import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listBackends, type BackendPreference } from "@/services/inference";
import { cn } from "@/lib/utils";

import type { BackendInfo } from "@/services/inference-backends";

/**
 * Where the next answer comes from.
 *
 * A backend, never a provider or a model: which company answers and with which
 * weights is the extension's choice, and IPA exists so the page does not make it.
 * What the page can offer is whether the question leaves the machine at all — and
 * until this existed, anyone with an extension installed could not reach the
 * browser's own model even though it is private and costs nothing.
 *
 * Unavailable backends stay listed and disabled with the reason: "no extension
 * found" and "downloads on first use" are different facts, and hiding either one
 * makes the absence look like a bug.
 */
export function BackendSelect({
  className,
  onChange,
  value,
}: {
  className?: string;
  onChange: (preference: BackendPreference) => void;
  value: BackendPreference;
}) {
  const [backends, setBackends] = useState<BackendInfo[]>();

  // Probed, not assumed: the on-device model reports four states and an
  // extension can be installed after this window opened.
  useEffect(() => {
    let live = true;
    void listBackends().then((list) => {
      if (live) setBackends(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const reachable = (backends ?? []).filter(
    (backend) => backend.availability !== "unavailable",
  );
  // One place to send a question is not a choice.
  if (reachable.length < 2) return null;

  return (
    <Select
      onValueChange={(next) => onChange(next as BackendPreference)}
      value={value}
    >
      <SelectTrigger
        className={cn("h-6 w-auto gap-1 border-none px-1 text-xs", className)}
        title="Where the next answer comes from"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto</SelectItem>
        {(backends ?? []).map((backend) => (
          <SelectItem
            disabled={backend.availability === "unavailable"}
            key={backend.id}
            value={backend.id}
          >
            {backend.label}
            {backend.availability === "downloadable" && " (downloads first)"}
            {backend.availability === "downloading" && " (downloading)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
