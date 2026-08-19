/**
 * Starting a run, which needs no new protocol at all.
 *
 * An agent opens a session when it is sent a message that threads onto nothing,
 * and continues one when the message is a reply. That rule already exists and is
 * already load-bearing — it is how a new subject stops inheriting an hour of
 * unrelated context — so "start a session" is a NIP-17 DM with no `e` tag, and a
 * `1779` control verb for it would be a second way to say the same thing.
 *
 * The only thing added here is the preamble. An agent handed "fix the parser"
 * with no other context works on whatever it happens to have, and a run that
 * reads the wrong repository answers confidently about the wrong code.
 *
 * What the preamble carries is the CLONE URL, from the repository's own kind
 * 30617. That is the one identifier that works whether or not the agent already
 * has a copy: an agent holding the checkout recognises it, and an agent without
 * one can fetch it. A sandbox path would be this client guessing at the inside
 * of someone else's machine — and a guessed path produces a prompt the agent
 * silently ignores and a session that looks like it worked.
 */

import type { ISigner } from "applesauce-signers";

import { sendDirectMessage } from "@/lib/dm/send";
import type { MyRepository } from "@/hooks/useMyRepositories";

export interface StartSessionParams {
  viewer: string;
  signer: ISigner;
  /** The agent's pubkey. */
  agent: string;
  /** What to ask it. */
  prompt: string;
  /** Scope the run to one checkout, by the path the agent published. */
  repository?: MyRepository;
}

/**
 * The preamble a repo-scoped run opens with.
 *
 * Written as an instruction rather than as metadata because the receiving end
 * is a language model reading a chat message, not a parser: there is no field
 * on a NIP-17 rumor that an agent runtime would read as "work here", and
 * inventing one would need the agent to know about it. A sentence works today.
 */
export function scopedPrompt(
  prompt: string,
  repository?: MyRepository,
): string {
  if (!repository) return prompt;
  const where = repository.clone
    ? `Work on the repository ${repository.name} (${repository.clone}). If you already have a checkout of it, use that one.`
    : `Work on the repository ${repository.name}.`;
  return `${where}\n\n${prompt}`;
}

/**
 * Send the opening message of a new run.
 *
 * No `replyTo`, and that omission is the whole mechanism: a threaded message
 * continues whatever session the agent already has with this person, which is
 * the opposite of what starting one means.
 */
export async function startSession({
  viewer,
  signer,
  agent,
  prompt,
  repository,
}: StartSessionParams): Promise<{ id: string }> {
  const body = scopedPrompt(prompt.trim(), repository);
  if (!body) throw new Error("a run needs something to work on");

  const result = await sendDirectMessage({
    viewer,
    signer,
    peers: [agent],
    content: body,
  });

  /**
   * A run nobody received has not started.
   *
   * `sendDirectMessage` reports per-recipient delivery, and a failure here is
   * the difference between "the agent is thinking" and "nothing happened" —
   * which look identical in a transcript list until someone waits ten minutes.
   */
  const delivered = (result.peers.get(agent) ?? []).some(
    (attempt) => attempt.ok,
  );
  if (!delivered)
    throw new Error(
      "no relay in the agent's inbox accepted the message, so nothing was started",
    );

  return { id: result.rumor.id };
}
