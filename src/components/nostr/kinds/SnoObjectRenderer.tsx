import {
  getSnoEncryptedTag,
  SNO_AVATAR_KIND,
  type SnoObject,
} from "@/lib/sno-parser";
import { formatExact, useLocale } from "@/hooks/useLocale";
import { Label } from "@/components/ui/label";
import { RichText } from "@/components/nostr/RichText";
import { SnoSceneView } from "@/components/nostr/sno/SnoSceneView";
import { useSnoObject } from "@/components/nostr/sno/useSnoObject";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/** What an object is made of: vertex and face counts and its lattice scale. */
export function SnoSummaryLabels({ object }: { object: SnoObject }) {
  const { locale } = useLocale();
  return (
    <>
      <Label title="vertices">
        {formatExact(object.vertices.length, locale)} v
      </Label>
      <Label title="faces">{formatExact(object.faces.length, locale)} f</Label>
      <Label title="one model unit is 2^unit base units">
        unit 2^{object.unit}
      </Label>
      {object.up && (
        <Label title="stands on the Earth's surface">up {object.spin}°</Label>
      )}
    </>
  );
}

/** §3.4: the preview a hidden object shows to a client that cannot open it. */
export function SnoHiddenPreview({
  event,
  encrypted,
}: BaseEventProps & { encrypted: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      {event.content ? (
        <RichText event={event} className="text-sm" />
      ) : (
        <div className="text-sm">
          This object is hidden at a place in cyberspace.
        </div>
      )}
      <div className="text-xs text-muted-foreground italic">
        Encrypted to a region ({encrypted[1] || "unknown cipher"}); only a
        client that has found the place can open it.
      </div>
    </div>
  );
}

/**
 * Kinds 33331, 3330 and 11333 Renderer - SNO object (Feed View)
 * DECK-0003: a small 3D object carried as JSON in `content`.
 */
export function SnoObjectRenderer({ event }: BaseEventProps) {
  const result = useSnoObject(event);
  const encrypted = getSnoEncryptedTag(event);

  if (encrypted) {
    return (
      <BaseEventContainer event={event}>
        <SnoHiddenPreview event={event} encrypted={encrypted} />
      </BaseEventContainer>
    );
  }

  if (event.kind === SNO_AVATAR_KIND && event.content.trim() === "") {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Default avatar
        </div>
      </BaseEventContainer>
    );
  }

  if (!result.ok) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Invalid SNO object: {result.error}
        </div>
      </BaseEventContainer>
    );
  }

  const { object } = result;
  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="text-sm font-medium text-foreground"
        >
          {object.name || "Untitled object"}
        </ClickableEventTitle>
        <SnoSceneView
          event={event}
          object={object}
          interactive={false}
          autoRotate
          className="h-52 bg-muted/20"
        />
      </div>
    </BaseEventContainer>
  );
}
