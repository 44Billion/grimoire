/**
 * Telling a running session what to do.
 *
 * Everything else the viewer does with a session is reading. This writes: a
 * kind-1779 rumor, gift-wrapped to the agent, that makes it answer a question,
 * change course, or stop. It is the only outward-facing thing in the agent
 * window, and the reason a transcript is not merely a log.
 *
 * The rumor is delivered by the same path as a private message, because it IS
 * one in every respect that matters — a rumor in a wrap, addressed to one key,
 * with the seal proving who wrote it. What differs is the kind, and the DM
 * pipeline is told to accept it so the operator's own copy lands in the same
 * store as everything else in the session.
 *
 * A control event is never stored as chat: it carries no `p`-tagged conversation
 * and is not in `DM_ROW_KINDS`, so it cannot appear in, bump, or badge a
 * conversation.
 */

import { getEventHash } from "nostr-tools";
import type { EventSigner } from "applesauce-core";

import { KIND_SESSION_CONTROL } from "@/lib/agent-session/kinds";
import { sessionAddress } from "@/lib/agent-session/encode";
import { deliverRumor } from "@/lib/dm/send";
import { resolveDmRelays } from "@/lib/dm/relays";

export type SessionCommand =
  "start" | "respond" | "steer" | "cancel" | "compact" | "clear" | "reset";

export interface SendControlParams {
  viewer: string;
  signer: EventSigner;
  agent: string;
  session: string;
  command: SessionCommand;
  /** The request being answered. Required for `respond`; ignored otherwise. */
  request?: string;
  /** The option chosen, when the question offered any. */
  option?: string;
  /** Free text: the answer for `respond`, the message for `steer`. */
  text?: string;
  /** The turn being stopped, when `cancel` means a specific one. */
  turn?: string;
  /**
   * What a `steer` does to the turn already running.
   *
   * Left alone the agent queues, which is what an operator adding to work in
   * progress almost always means. `steer` is "stop that and do this instead",
   * and throws away whatever the running turn had got to.
   */
  policy?: "queue" | "steer";
  /**
   * What a `start` is about: `["a", "30617:<pubkey>:<d>"]` for a repository,
   * `["e", "<id>"]` for an event. Ignored by every other verb, which names a
   * session that already carries them.
   */
  subjects?: string[][];
}

/**
 * Build, wrap and send one instruction.
 *
 * The agent is the only recipient — an observer reading the transcript has no
 * business receiving the instruction, and a wrap per recipient is a wrap per
 * recipient.
 */
export async function sendSessionControl({
  viewer,
  signer,
  agent,
  session,
  command,
  request,
  option,
  text,
  turn,
  policy,
  subjects,
}: SendControlParams): Promise<void> {
  const tags: string[][] = [
    ["a", sessionAddress(agent, session)],
    ["p", agent],
    ["command", command],
  ];
  if (request) tags.push(["request", request]);
  if (turn) tags.push(["turn", turn]);
  if (option) tags.push(["option", option]);
  if (policy) tags.push(["policy", policy]);
  for (const subject of subjects ?? [])
    if (subject[0] && subject[1]) tags.push(subject);
  tags.push(["alt", `Session control: ${command}`]);

  const stamped = {
    kind: KIND_SESSION_CONTROL,
    pubkey: viewer,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    // A steer is a message, and a message goes in content — the one place this
    // family always puts prose.
    content: text ?? "",
  };

  const { relays, source } = await resolveDmRelays(agent);
  if (source === "none")
    throw new Error(
      "That agent publishes no inbox relays, so there is nowhere to send it.",
    );

  await deliverRumor(viewer, signer, new Map([[agent, relays]]), {
    ...stamped,
    id: getEventHash(stamped),
  } as never);
}
