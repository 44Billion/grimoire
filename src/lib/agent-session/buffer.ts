/**
 * A turn being written, assembled from deltas.
 *
 * A delta carries a fragment and where it belongs: which turn, which part of that
 * turn, and what kind of thing it is. Reassembling them is append-per-part, and
 * the interesting decisions are all about what to do when something is missing.
 *
 * **A hole stops the preview, and does not discard it.** `part` is a counter local
 * to the turn, so a missing number means a fragment has not arrived — but "not
 * arrived" and "arrived out of order" look identical at the moment they happen,
 * and four relays deliver in whatever order they feel like. So the readable text
 * is the CONTIGUOUS run from part 1, anything past a hole is held rather than
 * rendered, and a late fragment filling the hole completes the sentence. What is
 * never done is rendering across a hole: text with an invisible gap in it is worse
 * than short text, because nobody can see the gap.
 *
 * **A new turn clears the old one.** Deltas describe the turn in progress; once
 * the next has started, the previous one's fragments are history that the stored
 * turn already tells better.
 *
 * **Nothing here is ordered by a clock.** A wrap's timestamp is the publisher's
 * to choose and two machines disagree; `turn` and `part` are the only ordering,
 * exactly as `seq` is for the durable path.
 *
 * Bounded, because anyone can send you 21059s: a fixed number of parts and a
 * fixed number of bytes, after which fragments are dropped rather than kept.
 */

import type { DecodedDelta, DeltaKind } from "./types";

/** One part of the turn being written. */
export interface BufferedPart {
  part: number;
  delta: DeltaKind;
  text: string;
  /** Which call a `tool` fragment belongs to. */
  toolId?: string;
}

/**
 * How much of one turn's preview is held.
 *
 * A turn caps at 48 KiB on the wire, so a preview larger than that is describing
 * something the stored turn will not even contain. The part cap matches the
 * publisher's own per-turn delta ceiling.
 */
export const MAX_PARTS = 200;
export const MAX_BYTES = 48 * 1024;

export class DeltaBuffer {
  /** The turn these fragments belong to. 0 means nothing yet. */
  private currentTurn = 0;
  private parts = new Map<number, BufferedPart>();
  private bytes = 0;
  private dropped = false;

  /** Which turn is being written, if any. */
  get turn(): number {
    return this.currentTurn;
  }

  /**
   * Whether something is being held back — a hole not yet filled, or a cap hit.
   *
   * Reported so a reader is told the preview is partial rather than shown a
   * sentence that quietly stops.
   */
  get incomplete(): boolean {
    return this.dropped || this.parts.size > this.current.length;
  }

  /**
   * The readable run: parts 1, 2, 3… up to the first one missing.
   *
   * A fragment beyond a hole is kept in the map and will render as soon as the
   * hole fills. This is the whole ordering discipline — no clocks, because a
   * wrap's timestamp is the publisher's to choose and two machines disagree.
   */
  get current(): BufferedPart[] {
    const run: BufferedPart[] = [];
    for (let part = 1; ; part += 1) {
      const found = this.parts.get(part);
      if (!found) break;
      run.push(found);
    }
    return run;
  }

  /**
   * Take one delta.
   *
   * Returns whether the buffer changed, so a caller can skip a repaint for a
   * duplicate or for a fragment from a turn already closed.
   */
  apply(delta: DecodedDelta): boolean {
    if (delta.turn < this.currentTurn) return false;

    if (delta.turn > this.currentTurn) {
      this.currentTurn = delta.turn;
      this.parts = new Map();
      this.bytes = 0;
      this.dropped = false;
    }

    if (this.parts.size >= MAX_PARTS || this.bytes >= MAX_BYTES) {
      // Anyone can send you 21059s. Past the cap, fragments are dropped and the
      // reader is told the preview is partial.
      this.dropped = true;
      return false;
    }

    const existing = this.parts.get(delta.part);
    if (existing) {
      // The same part arriving twice is a relay duplicate, not more text.
      if (existing.text === delta.text) return false;
      this.bytes += delta.text.length;
      existing.text = delta.text;
      return true;
    }

    this.bytes += delta.text.length;
    this.parts.set(delta.part, {
      part: delta.part,
      delta: delta.delta,
      text: delta.text,
      toolId: delta.toolId,
    });
    return true;
  }

  /**
   * Forget everything, because the stored turn has arrived.
   *
   * Called when a `1777` for this turn lands: from that moment the durable event
   * is the better copy, and showing both means showing the same words twice.
   */
  settle(turn: number): void {
    if (turn < this.currentTurn) return;
    this.currentTurn = 0;
    this.parts = new Map();
    this.bytes = 0;
    this.dropped = false;
  }

  /** One string per kind, in order, for rendering a turn in progress. */
  text(kind: DeltaKind): string {
    return this.current
      .filter((part) => part.delta === kind)
      .map((part) => part.text)
      .join("");
  }
}
