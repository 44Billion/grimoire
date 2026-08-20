/**
 * Starting a run, which needs no new protocol at all.
 *
 * An agent opens a session when it is sent a message that threads onto nothing,
 * and continues one when the message is a reply. That rule already exists and is
 * already load-bearing — it is how a new subject stops inheriting an hour of
 * unrelated context — so "start a session" is a NIP-17 DM with no `e` tag.
 *
 * What a run is ABOUT travels as tags, not as prose. A repository is an `a`
 * pointing at its kind-30617 address; an event is an `e`. The agent resolves
 * them and grounds itself in what they name, exactly as `Ask Hex` grounds a
 * conversation in the event it was opened from — and because they are tags, a
 * reader can find every run about a thing by asking for them, rather than
 * matching titles and hoping.
 *
 * The alternative was a sentence: "Work on the repository X…" prepended to the
 * message. It was wrong twice — an agent titles a run from its first message, so
 * every scoped run came out named after the boilerplate, and a client writing
 * instructions into someone's message puts words in their mouth that the whole
 * transcript then attributes to them.
 */

import type { ISigner } from "applesauce-signers";

import { sendDirectMessage } from "@/lib/dm/send";

export interface StartSessionParams {
  viewer: string;
  signer: ISigner;
  /** The agent's pubkey. */
  agent: string;
  /** What to ask it, in the operator's own words and nobody else's. */
  prompt: string;
  /**
   * What the run is about, as tags: `["a", "30617:<pubkey>:<d>"]` for a
   * repository, `["e", "<id>"]` for an event.
   */
  subjects?: string[][];
}

export async function startSession({
  viewer,
  signer,
  agent,
  prompt,
  subjects = [],
}: StartSessionParams): Promise<{ id: string }> {
  const body = prompt.trim();
  if (!body) throw new Error("a run needs something to work on");

  const result = await sendDirectMessage({
    viewer,
    signer,
    peers: [agent],
    content: body,
    tags: subjects,
  });

  /**
   * A run nobody received has not started.
   *
   * A failure here is the difference between "the agent is thinking" and
   * "nothing happened" — which look identical in a transcript list until
   * someone has waited ten minutes.
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
