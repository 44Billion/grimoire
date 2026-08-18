// @vitest-environment happy-dom
/**
 * The hook reads an external store, and that is exactly what makes it fragile.
 *
 * `useSyncExternalStore` compares snapshots BY REFERENCE. A group nothing is
 * known about used to get a fresh `[]` on every read, which reads as "changed"
 * every time — the component re-rendered until React gave up with "Maximum
 * update depth exceeded". Nothing about that is visible in a type or in a lint
 * rule, and the group with no roster is the common case: every group without an
 * AV space, and every group before its relay first answers.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { useGroupParticipants } from "@/hooks/useNip29Participants";

vi.mock("@/services/relay-pool", () => ({
  default: {
    subscription: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  },
}));
vi.mock("@/services/event-store", () => ({ default: {} }));

function Probe({
  relayUrl,
  groupId,
  onRender,
}: {
  relayUrl?: string;
  groupId?: string;
  onRender: () => void;
}) {
  onRender();
  const participants = useGroupParticipants(relayUrl, groupId);
  return <div data-testid="count">{participants.length}</div>;
}

describe("useGroupParticipants", () => {
  it("settles for a group whose roster nobody has seen", () => {
    let renders = 0;
    const { getByTestId } = render(
      <Probe
        relayUrl="wss://relay.example.com"
        groupId="nobody-has-seen-this"
        onRender={() => {
          renders++;
          if (renders > 100) throw new Error("render loop");
        }}
      />,
    );
    expect(getByTestId("count").textContent).toBe("0");
    expect(renders).toBeLessThan(5);
  });

  it("settles with no group at all", () => {
    let renders = 0;
    render(
      <Probe
        onRender={() => {
          renders++;
          if (renders > 100) throw new Error("render loop");
        }}
      />,
    );
    expect(renders).toBeLessThan(5);
  });
});
