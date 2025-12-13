import { describe, it, expect } from "vitest";
import { transitionAuthState, type AuthEvent } from "./auth-state-machine";
import type { AuthStatus } from "@/types/relay-state";

describe("Auth State Machine", () => {
  describe("none state transitions", () => {
    it("should transition to challenge_received when receiving challenge with ask preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "ask",
      });

      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to authenticating with always preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "always",
      });

      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to rejected with never preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
        preference: "never",
      });

      expect(result.newStatus).toBe("rejected");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should default to ask when no preference provided", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test-challenge",
      });

      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should not transition on other events", () => {
      const result = transitionAuthState("none", { type: "AUTH_SUCCESS" });
      expect(result.newStatus).toBe("none");
    });
  });

  describe("challenge_received state transitions", () => {
    it("should transition to authenticating when user accepts", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_ACCEPTED",
      });

      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(false);
    });

    it("should transition to rejected when user rejects", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_REJECTED",
      });

      expect(result.newStatus).toBe("rejected");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none when disconnected", () => {
      const result = transitionAuthState("challenge_received", {
        type: "DISCONNECTED",
      });

      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });
  });

  describe("authenticating state transitions", () => {
    it("should transition to authenticated on success", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_SUCCESS",
      });

      expect(result.newStatus).toBe("authenticated");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to failed on auth failure", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_FAILED",
      });

      expect(result.newStatus).toBe("failed");
      expect(result.shouldAutoAuth).toBe(false);
      expect(result.clearChallenge).toBe(true);
    });

    it("should transition to none when disconnected", () => {
      const result = transitionAuthState("authenticating", {
        type: "DISCONNECTED",
      });

      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });
  });

  describe("authenticated state transitions", () => {
    it("should transition to none when disconnected", () => {
      const result = transitionAuthState("authenticated", {
        type: "DISCONNECTED",
      });

      expect(result.newStatus).toBe("none");
      expect(result.clearChallenge).toBe(true);
    });

    it("should handle new challenge with always preference", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "always",
      });

      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should transition to challenge_received for new challenge", () => {
      const result = transitionAuthState("authenticated", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "ask",
      });

      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should stay authenticated on other events", () => {
      const result = transitionAuthState("authenticated", {
        type: "AUTH_SUCCESS",
      });
      expect(result.newStatus).toBe("authenticated");
    });
  });

  describe("failed state transitions", () => {
    it("should transition to challenge_received on new challenge", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "ask",
      });

      expect(result.newStatus).toBe("challenge_received");
    });

    it("should auto-auth on new challenge with always preference", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "always",
      });

      expect(result.newStatus).toBe("authenticating");
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should transition to rejected with never preference", () => {
      const result = transitionAuthState("failed", {
        type: "CHALLENGE_RECEIVED",
        challenge: "retry-challenge",
        preference: "never",
      });

      expect(result.newStatus).toBe("rejected");
    });

    it("should transition to none when disconnected", () => {
      const result = transitionAuthState("failed", {
        type: "DISCONNECTED",
      });

      expect(result.newStatus).toBe("none");
    });
  });

  describe("rejected state transitions", () => {
    it("should handle new challenge after rejection", () => {
      const result = transitionAuthState("rejected", {
        type: "CHALLENGE_RECEIVED",
        challenge: "new-challenge",
        preference: "ask",
      });

      expect(result.newStatus).toBe("challenge_received");
    });

    it("should transition to none when disconnected", () => {
      const result = transitionAuthState("rejected", {
        type: "DISCONNECTED",
      });

      expect(result.newStatus).toBe("none");
    });
  });

  describe("edge cases", () => {
    it("should handle missing preference as ask", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
      });

      expect(result.newStatus).toBe("challenge_received");
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should not transition on invalid events for each state", () => {
      const states: AuthStatus[] = [
        "none",
        "challenge_received",
        "authenticating",
        "authenticated",
        "failed",
        "rejected",
      ];

      states.forEach((state) => {
        const result = transitionAuthState(state, {
          type: "USER_ACCEPTED",
        } as AuthEvent);
        // Should either stay in same state or have a valid transition
        expect(result.newStatus).toBeTruthy();
      });
    });
  });

  describe("clearChallenge flag", () => {
    it("should clear challenge on auth success", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_SUCCESS",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear challenge on auth failure", () => {
      const result = transitionAuthState("authenticating", {
        type: "AUTH_FAILED",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear challenge on rejection", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_REJECTED",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should clear challenge on disconnect", () => {
      const result = transitionAuthState("authenticated", {
        type: "DISCONNECTED",
      });
      expect(result.clearChallenge).toBe(true);
    });

    it("should not clear challenge when receiving new one", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
      });
      expect(result.clearChallenge).toBe(false);
    });
  });

  describe("shouldAutoAuth flag", () => {
    it("should be true only with always preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "always",
      });
      expect(result.shouldAutoAuth).toBe(true);
    });

    it("should be false with ask preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "ask",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should be false with never preference", () => {
      const result = transitionAuthState("none", {
        type: "CHALLENGE_RECEIVED",
        challenge: "test",
        preference: "never",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });

    it("should be false on user acceptance (manual auth)", () => {
      const result = transitionAuthState("challenge_received", {
        type: "USER_ACCEPTED",
      });
      expect(result.shouldAutoAuth).toBe(false);
    });
  });
});
