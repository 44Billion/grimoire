import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { RichText } from "../RichText";

/**
 * Renderer for Kind 1 - Short Text Note
 */
export function Kind1Renderer({ event, showTimestamp }: BaseEventProps) {
  return (
    <BaseEventContainer event={event} showTimestamp={showTimestamp}>
      <RichText event={event} className="text-sm" />
    </BaseEventContainer>
  );
}
