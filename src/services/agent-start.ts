/**
 * Starting a run, over the control plane rather than in a conversation.
 *
 * This used to be a NIP-17 DM with no `e` tag, leaning on the agent's own rule
 * that a message threading onto nothing opens a session. That worked and had
 * two costs. Every run began as a chat message, so asking an agent for work
 * meant holding a conversation with it whether or not anyone wanted one — the
 * agent replied in the room, the room accumulated, and a client that renders
 * transcripts had a second surface saying the same thing worse. And the session
 * was named by the agent, so this end could not subscribe to it until the head
 * arrived, which meant polling for a run whose name it did not yet know.
 *
 * A `start` command fixes both. It is not a message: nothing is said, no room is
 * opened, and the agent knows not to offer itself chat tools it has nowhere to
 * use. And the session id is chosen HERE — 32 random bytes, the same shape the
 * agent would have picked — so the address is subscribable before the work
 * begins. The agent refuses a second start for a name it has already published,
 * which is what makes that safe when four relays deliver the same wrap.
 *
 * What a run is ABOUT still travels as tags, not as prose. A repository is an
 * `a` pointing at its kind-30617 address; an event is an `e`. The agent resolves
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

import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";

import { sendSessionControl } from "@/services/agent-control";

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
}: StartSessionParams): Promise<{ session: string }> {
  const body = prompt.trim();
  if (!body) throw new Error("a run needs something to work on");

  /**
   * The session's name, chosen before the session exists.
   *
   * Random rather than derived from anything: a session id is a public `d` tag
   * on the agent's own replaceable event, and one derived from the prompt or
   * the clock would let a reader who guesses the input find or clash with the
   * run. Thirty-two bytes is what the agent picks when it names its own.
   */
  const session = bytesToHex(randomBytes(32));

  await sendSessionControl({
    viewer,
    signer,
    agent,
    session,
    command: "start",
    text: body,
    subjects,
  });

  return { session };
}
