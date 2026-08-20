/**
 * `agent [naddr|npub|<agent-npub> <session-id>]` argument parsing.
 *
 * A session's address is `31777:<agent-pubkey>:<session-id>`, so an `naddr`
 * carries everything needed. The looser forms exist because an agent that told
 * you a session id in a chat message did not hand you a bech32 string.
 */

import { nip19 } from "nostr-tools";

import { KIND_SESSION_HEAD } from "@/lib/agent-session/kinds";
import { parseSessionAddress } from "@/lib/agent-session/encode";

export interface AgentCommandProps {
  /** The agent's pubkey, lowercase hex. */
  agent?: string;
  /** The session id — the head's `d` tag. */
  session?: string;
  dynamicTitle?: string;
}

function decodeBech32(token: string): AgentCommandProps | null {
  try {
    const decoded = nip19.decode(token);

    if (decoded.type === "naddr") {
      const pointer = decoded.data;
      if (pointer.kind !== KIND_SESSION_HEAD) return null;
      return {
        agent: pointer.pubkey,
        session: pointer.identifier,
        dynamicTitle: `AGENT ${pointer.identifier.slice(0, 8)}`,
      };
    }

    if (decoded.type === "npub")
      return { agent: decoded.data, dynamicTitle: "AGENT" };

    if (decoded.type === "nprofile")
      return { agent: decoded.data.pubkey, dynamicTitle: "AGENT" };
  } catch {
    // Not bech32; the caller's other forms still apply.
  }
  return null;
}

export function parseAgentCommand(args: string[]): AgentCommandProps {
  const tokens = args.filter(Boolean);
  if (tokens.length === 0) return {};

  const first = tokens[0]!;

  // A full session address, as it appears in an `a` tag.
  const address = parseSessionAddress(first);
  if (address?.kind === KIND_SESSION_HEAD)
    return {
      agent: address.agent,
      session: address.session,
      dynamicTitle: `AGENT ${address.session.slice(0, 8)}`,
    };

  const bech32 = decodeBech32(first);
  if (bech32) {
    // `agent npub1… <session>` — the session id given separately.
    if (!bech32.session && tokens[1])
      return {
        ...bech32,
        session: tokens[1],
        dynamicTitle: `AGENT ${tokens[1].slice(0, 8)}`,
      };
    return bech32;
  }

  // Raw hex: a pubkey, optionally with a session id after it.
  if (/^[0-9a-f]{64}$/.test(first))
    return {
      agent: first,
      session: tokens[1],
      dynamicTitle: tokens[1] ? `AGENT ${tokens[1].slice(0, 8)}` : "AGENT",
    };

  return {};
}
