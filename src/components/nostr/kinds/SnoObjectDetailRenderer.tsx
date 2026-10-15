import { useMemo, useState } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  getSnoCreditAddress,
  getSnoEncryptedTag,
  rgbToHex,
  SNO_AVATAR_KIND,
  SNO_MODES,
  type SnoMode,
  type SnoObject,
  type SnoRef,
} from "@/lib/sno-parser";
import { Button } from "@/components/ui/button";
import { UserName } from "@/components/nostr/UserName";
import { SnoSceneView } from "@/components/nostr/sno/SnoSceneView";
import type { SnoSceneNode } from "@/components/nostr/sno/scene";
import { useSnoObject } from "@/components/nostr/sno/useSnoObject";
import { useCopy } from "@/hooks/useCopy";
import { formatExact, useLocale } from "@/hooks/useLocale";
import { useAddWindow } from "@/core/state";
import { SnoHiddenPreview, SnoSummaryLabels } from "./SnoObjectRenderer";

function paletteSourceText(object: SnoObject): string {
  const s = object.paletteSource;
  if (s.kind === "built-in") return "built-in (cyberspace-neon-256)";
  if (s.kind === "inline") {
    return `carried inline (${object.palette.length} colors)`;
  }
  return s.resolved
    ? `referenced event (${object.palette.length} colors)`
    : "referenced event, not yet fetched: showing the built-in";
}

/** §1.8: the grid the object was built on, and whether the data outgrew it. */
function extentText(object: SnoObject): string {
  const spans = `${object.extent} units, the grid spans ±${object.extent}`;
  if (object.declaredExtent === undefined) return spans;
  if (object.declaredExtent === object.extent) return spans;
  return `${spans}, raised from ${object.declaredExtent} to fit`;
}

/** The distinct colors an object actually uses, in first-use order. */
function usedColors(object: SnoObject): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...object.colors, ...(object.faceColors ?? [])]) {
    const hex = rgbToHex(c);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

function RefLine({ ref_, name }: { ref_: SnoRef; name?: string }) {
  const addWindow = useAddWindow();
  const relays = ref_[2] ? [ref_[2]] : undefined;
  if (ref_[0] === "e") {
    return (
      <button
        className="flex items-center gap-1 text-left text-xs hover:underline"
        onClick={() => addWindow("open", { pointer: { id: ref_[1], relays } })}
      >
        {name && <span>{name}</span>}
        <span className="font-mono text-muted-foreground">
          e {ref_[1].slice(0, 16)}…
        </span>
      </button>
    );
  }
  const [kind, pubkey, ...rest] = ref_[1].split(":");
  const identifier = rest.join(":");
  return (
    <button
      className="flex items-center gap-1 text-left text-xs"
      onClick={() =>
        addWindow("open", {
          pointer: { kind: Number(kind), pubkey, identifier, relays },
        })
      }
    >
      {name ? (
        <span>{name}</span>
      ) : (
        <span className="font-mono text-muted-foreground">{identifier}</span>
      )}
      <span className="text-muted-foreground">by</span>
      <UserName pubkey={pubkey} className="text-xs" />
    </button>
  );
}

/**
 * Kinds 33331, 3330 and 11333 Detail Renderer - SNO object (Detail View)
 * Full-size interactive canvas with a mode switch, the numbers, the colors
 * used, the placed objects, and the credit for a copy (DECK-0003 §3.5).
 */
export function SnoObjectDetailRenderer({ event }: { event: NostrEvent }) {
  const result = useSnoObject(event);
  const encrypted = getSnoEncryptedTag(event);
  const credit = getSnoCreditAddress(event);
  const { copy } = useCopy();
  const { locale } = useLocale();
  const [modeOverride, setModeOverride] = useState<SnoMode | undefined>();
  const [parts, setParts] = useState<SnoSceneNode[]>([]);
  const colors = useMemo(
    () => (result.ok ? usedColors(result.object) : []),
    [result],
  );

  if (encrypted) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <SnoHiddenPreview event={event} encrypted={encrypted} />
        <p className="text-sm text-muted-foreground">
          The payload is encrypted with the region key of the place it was
          hidden at (key {encrypted[3] || "unspecified"}).
        </p>
      </div>
    );
  }

  if (event.kind === SNO_AVATAR_KIND && event.content.trim() === "") {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Default avatar: this event carries no object of its own.
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="text-center text-muted-foreground">
          This event is not a valid SNO object and was not rendered.
        </div>
        <div className="text-center font-mono text-xs text-destructive">
          {result.error}
        </div>
      </div>
    );
  }

  const { object } = result;
  const mode = modeOverride ?? object.mode;
  const creditParts = credit?.split(":");
  const nameOf = (refIndex: number) =>
    parts.find((p) => p.ref === refIndex && p.name)?.name;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          {object.name || "Untitled object"}
        </h1>
        <div className="flex gap-1" role="group" aria-label="Render mode">
          {SNO_MODES.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? "default" : "outline"}
              aria-pressed={mode === m}
              onClick={() => setModeOverride(m === object.mode ? undefined : m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <SnoSceneView
        event={event}
        object={object}
        mode={modeOverride}
        interactive
        className="h-96 bg-muted/20"
        onParts={setParts}
      />

      <div className="flex flex-wrap gap-1">
        <SnoSummaryLabels object={object} />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Format</dt>
        <dd>v{object.v}</dd>
        <dt className="text-muted-foreground">Extent</dt>
        <dd>{extentText(object)}</dd>
        <dt className="text-muted-foreground">Palette</dt>
        <dd>{paletteSourceText(object)}</dd>
        {object.faceColors && (
          <>
            <dt className="text-muted-foreground">Face colors</dt>
            <dd>flat, one per face</dd>
          </>
        )}
        {object.up && (
          <>
            <dt className="text-muted-foreground">Orientation</dt>
            <dd>stands on the Earth, +Z faces bearing {object.spin}°</dd>
          </>
        )}
      </dl>

      {colors.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Colors used</h2>
          <div className="flex flex-wrap gap-1">
            {colors.map((hex) => (
              <button
                key={hex}
                className="flex items-center gap-1 rounded-md border border-border px-1.5 py-1 hover:bg-muted/50 transition-colors"
                onClick={() => copy(hex)}
                title={`Copy ${hex}`}
              >
                <span
                  className="size-4 shrink-0 rounded ring-1 ring-border"
                  style={{ backgroundColor: hex }}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {hex}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {object.refs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            Places {formatExact(object.parts.length, locale)} part
            {object.parts.length === 1 ? "" : "s"} of {object.refs.length}{" "}
            object{object.refs.length === 1 ? "" : "s"}
          </h2>
          <ul className="flex flex-col gap-1">
            {object.refs.map((ref, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  ×{object.parts.filter((p) => p.ref === i).length}
                </span>
                <RefLine ref_={ref} name={nameOf(i)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {creditParts && creditParts.length >= 3 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Copied from</span>
          <UserName pubkey={creditParts[1]} className="text-xs" />
          <span className="font-mono">/ {creditParts.slice(2).join(":")}</span>
        </div>
      )}
    </div>
  );
}
