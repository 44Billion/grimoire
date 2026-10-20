import { toast } from "sonner";
import { NostrConnectSigner } from "applesauce-signers";
import accountManager from "@/services/accounts";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Warns when a newly blocked relay is one the app itself depends on.
 *
 * Not a refusal: the user's list is the user's list. But a silent brick is not
 * an acceptable way to honour it.
 */
export function warnIfBlockingOwnInfrastructure(
  blockedUrls: string[],
  walletRelays: string[],
) {
  if (blockedUrls.length === 0) return;

  const blocked = new Set<string>();
  for (const url of blockedUrls) {
    try {
      blocked.add(normalizeRelayURL(url));
    } catch {
      // ignore
    }
  }
  const account = accountManager.active$.value;

  const signerRelays: string[] =
    account?.signer instanceof NostrConnectSigner ? account.signer.relays : [];

  const collide = (relays: string[]) =>
    relays.filter((url) => {
      try {
        return blocked.has(normalizeRelayURL(url));
      } catch {
        return false;
      }
    });

  const signerHits = collide(signerRelays);
  if (signerHits.length > 0) {
    toast.warning(
      `Blocked your remote signer's relay (${signerHits.join(", ")}). Signing will stop working until you unblock it.`,
      { duration: 12000 },
    );
  }

  const walletHits = collide(walletRelays);
  if (walletHits.length > 0) {
    toast.warning(
      `Blocked your wallet's relay (${walletHits.join(", ")}). The wallet will stop responding until you unblock it.`,
      { duration: 12000 },
    );
  }
}
