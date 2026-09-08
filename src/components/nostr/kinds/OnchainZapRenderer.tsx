import { useMemo } from "react";

import type { NostrEvent } from "@/types/nostr";
import {
  BaseEventContainer,
  ClickableEventTitle,
  type BaseEventProps,
} from "./BaseEventRenderer";
import { KindRenderer } from "./index";
import { RichText } from "../RichText";
import { UserName } from "../UserName";
import { MempoolIcon } from "../MempoolIcon";
import { Label } from "@/components/ui/label";
import { Skeleton, EventCardSkeleton } from "@/components/ui/skeleton";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useOnchainZap, type OnchainZapResult } from "@/hooks/useOnchainZap";
import { parseOnchainZap, type OnchainZapClaim } from "@/lib/onchain-zap";
import { getMempoolTxUrl } from "@/lib/mempool";
import { parseAddressPointer } from "@/lib/nip89-helpers";

/**
 * Kind 8333 — on-chain zaps (Ditto's `NIP.md`).
 *
 * A Bitcoin transaction paying the recipient's pubkey-derived Taproot address,
 * with this event linking it to what was zapped. The sender signs it, so the
 * `amount` tag is their word — {@link OnchainZapAmount} is the only thing here
 * allowed to draw a number, and only after checking the chain.
 *
 * Two differences from the kind-9735 renderer next door, both easy to get
 * wrong by analogy:
 *   - `content` is a plain comment. It is NOT a zap request, and must never be
 *     handed to a zap-request parser.
 *   - `event.pubkey` IS the sender, so there is no `authorOverride` — a 9735
 *     needs one because its signer is the recipient's LNURL provider.
 */

function txLabel(txid: string): string {
  return `${txid.slice(0, 8)}…${txid.slice(-8)}`;
}

/** The mempool.space link. The click is the reader's own disclosure to make. */
function TxLink({
  txid,
  children,
  className,
}: {
  txid: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      className={
        className ??
        "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      }
      href={getMempoolTxUrl(txid)}
      onClick={(e) => e.stopPropagation()}
      rel="noopener noreferrer"
      target="_blank"
      title={`View ${txid} on mempool.space`}
    >
      <MempoolIcon />
      {children}
    </a>
  );
}

/**
 * THE ONLY PLACE AN ON-CHAIN ZAP AMOUNT IS DRAWN.
 *
 * Every state resolves here, so no surface can accidentally invent its own
 * handling and print a claim:
 *   - verifying   → a skeleton where the number goes
 *   - verified    → the verified sats, capped at what the chain paid
 *   - unconfirmed → the same, plus `pending`; it can still be evicted
 *   - unavailable → `unverified` and no number; an outage is not a verdict
 *   - rejected    → nothing at all, per the spec's "SHOULD be discarded"
 */
export function OnchainZapAmount({
  claim,
  verdict,
}: {
  claim: OnchainZapClaim;
  /** Pass a verdict already in hand to avoid verifying the same tx twice. */
  verdict?: OnchainZapResult;
}) {
  const { locale } = useGrimoire();
  const own = useOnchainZap(verdict ? null : claim);
  const result = verdict ?? own;

  const formatted = useMemo(
    () =>
      result.amountSats === undefined
        ? { compact: "", exact: "" }
        : {
            // Compact to match the Lightning zap row beside it, which is what
            // a reader is comparing against.
            compact: new Intl.NumberFormat(locale.locale, {
              notation: "compact",
            }).format(result.amountSats),
            // The precision compact notation drops — "1.2K" is not a figure
            // anyone can check against a transaction.
            exact: new Intl.NumberFormat(locale.locale).format(
              result.amountSats,
            ),
          },
    [result.amountSats, locale.locale],
  );

  if (result.status === "rejected") return null;

  if (result.status === "unavailable") {
    return (
      <span className="inline-flex items-center gap-2">
        <TxLink txid={claim.txid} />
        <Label title="mempool.space could not be reached, so the amount is unchecked">
          unverified
        </Label>
      </span>
    );
  }

  if (result.status === "verifying") {
    return (
      <span className="inline-flex items-center gap-2">
        <TxLink txid={claim.txid} />
        <Skeleton className="h-4 w-16" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <TxLink txid={claim.txid} />
      <span
        className="text-lg font-light text-zap tabular-nums"
        title={`${formatted.exact} sats, verified on-chain`}
      >
        {formatted.compact}
      </span>
      <span className="text-xs text-muted-foreground">sats</span>
      {!result.confirmed && (
        <Label title="Still in the mempool — it can be replaced or dropped">
          pending
        </Label>
      )}
    </span>
  );
}

/** The recipients, named. Past two it becomes a count, or a feed row is a wall. */
function Recipients({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) return null;
  if (pubkeys.length <= 2) {
    return (
      <span className="inline-flex items-center gap-1 min-w-0">
        {pubkeys.map((pk) => (
          <UserName key={pk} pubkey={pk} />
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <UserName pubkey={pubkeys[0]} />
      <span className="text-xs text-muted-foreground">
        and {pubkeys.length - 1} more
      </span>
    </span>
  );
}

/** The zapped event, embedded. Resolved with the 8333 as relay context. */
function ZappedTarget({
  claim,
  event,
}: {
  claim: OnchainZapClaim;
  event: NostrEvent;
}) {
  const addressPointer = useMemo(
    () =>
      claim.targetAddress ? parseAddressPointer(claim.targetAddress) : null,
    [claim.targetAddress],
  );
  const eventPointer = useMemo(
    () => (claim.targetId ? { id: claim.targetId } : null),
    [claim.targetId],
  );

  // The 8333 is the context: its `p` tag is the recipient, i.e. the zapped
  // event's author, whose outbox routes the lookup.
  const byAddress = useNostrEvent(addressPointer ?? undefined, event);
  const byId = useNostrEvent(eventPointer ?? undefined, event);
  const target = byAddress ?? byId;

  if (!addressPointer && !eventPointer) return null;

  if (!target) {
    return (
      <div className="border border-muted p-2">
        <EventCardSkeleton variant="compact" showActions={false} />
      </div>
    );
  }

  return (
    <div className="border border-muted">
      <KindRenderer event={target} />
    </div>
  );
}

export function OnchainZapRenderer({ event }: BaseEventProps) {
  const claim = useMemo(() => parseOnchainZap(event), [event]);

  if (!claim) {
    // Malformed, or a self-zap. Both are trivial to fabricate and neither is a
    // weaker zap — they are no zap, so the row says so rather than showing a
    // number nothing backs.
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Invalid on-chain zap
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <OnchainZapAmount claim={claim} />
          <Recipients pubkeys={claim.recipientPubkeys} />
        </div>

        {claim.comment && (
          <div className="text-sm">
            <RichText event={event} />
          </div>
        )}

        <ZappedTarget claim={claim} event={event} />
      </div>
    </BaseEventContainer>
  );
}

export function OnchainZapDetailRenderer({ event }: { event: NostrEvent }) {
  const { locale } = useGrimoire();
  const claim = useMemo(() => parseOnchainZap(event), [event]);
  const verdict = useOnchainZap(claim);

  if (!claim) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <ClickableEventTitle event={event} className="text-lg font-semibold">
          On-chain Zap
        </ClickableEventTitle>
        <div className="text-sm text-muted-foreground italic">
          Not a valid on-chain zap — the transaction reference, recipients or
          amount are malformed, or the sender listed themselves as a recipient.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <ClickableEventTitle event={event} className="text-lg font-semibold">
        On-chain Zap
      </ClickableEventTitle>

      <div className="flex flex-wrap items-center gap-2">
        <OnchainZapAmount claim={claim} verdict={verdict} />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">From</span>
          <UserName pubkey={claim.senderPubkey} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {claim.recipientPubkeys.length > 1 ? "Recipients" : "To"}
          </span>
          <Recipients pubkeys={claim.recipientPubkeys} />
        </div>
      </div>

      {claim.comment && (
        <div className="text-sm">
          <RichText event={event} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Transaction</span>
        <TxLink
          txid={claim.txid}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {txLabel(claim.txid)}
        </TxLink>
      </div>

      {verdict.status === "verified" && verdict.overclaimed && (
        <div className="text-xs text-muted-foreground">
          The sender claimed{" "}
          {new Intl.NumberFormat(locale.locale).format(claim.claimedSats)} sats;
          the transaction paid less, so the smaller figure is the one shown.
        </div>
      )}

      {verdict.status === "rejected" && (
        <div className="text-xs text-muted-foreground italic">
          Nothing in this transaction reached any listed recipient, so it counts
          as no zap at all.
        </div>
      )}

      <ZappedTarget claim={claim} event={event} />
    </div>
  );
}
