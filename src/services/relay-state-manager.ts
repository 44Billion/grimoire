import type { IRelay } from "applesauce-relay";
import { merge } from "rxjs";
import type {
  RelayState,
  GlobalRelayState,
  AuthPreference,
} from "@/types/relay-state";
import pool from "./relay-pool";
import accountManager from "./accounts";
import db from "./db";

const MAX_NOTICES = 20;
const MAX_ERRORS = 20;

/**
 * Singleton service for managing global relay state
 * Subscribes to all relay observables and maintains state for all relays
 */
class RelayStateManager {
  private relayStates: Map<string, RelayState> = new Map();
  private subscriptions: Map<string, () => void> = new Map();
  private listeners: Set<(state: GlobalRelayState) => void> = new Set();
  private authPreferences: Map<string, AuthPreference> = new Map();
  private sessionRejections: Set<string> = new Set();
  private initialized = false;

  constructor() {
    this.loadAuthPreferences();
  }

  /**
   * Initialize relay monitoring for all relays in the pool
   */
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Load preferences from database
    await this.loadAuthPreferences();

    // Subscribe to existing relays
    pool.relays.forEach((relay) => {
      this.monitorRelay(relay);
    });

    // Poll for new relays every second
    setInterval(() => {
      pool.relays.forEach((relay) => {
        if (!this.subscriptions.has(relay.url)) {
          this.monitorRelay(relay);
        }
      });
    }, 1000);
  }

  /**
   * Ensure a relay is being monitored (call this when adding relays to pool)
   */
  ensureRelayMonitored(relayUrl: string) {
    const relay = pool.relay(relayUrl);
    if (relay && !this.subscriptions.has(relayUrl)) {
      this.monitorRelay(relay);
    }
  }

  /**
   * Subscribe to a single relay's observables
   */
  private monitorRelay(relay: IRelay) {
    const url = relay.url;

    // Initialize state if not exists
    if (!this.relayStates.has(url)) {
      this.relayStates.set(url, this.createInitialState(url));
    }

    // Subscribe to all relay observables
    const subscription = merge(
      relay.connected$,
      relay.notice$,
      relay.challenge$,
      relay.authenticated$,
    ).subscribe(() => {
      console.log(
        `[RelayStateManager] Observable triggered for ${url}, authenticated = ${relay.authenticated}, challenge = ${relay.challenge}`,
      );
      this.updateRelayState(url, relay);
    });

    // Store cleanup function
    this.subscriptions.set(url, () => subscription.unsubscribe());

    // Initial state update
    this.updateRelayState(url, relay);
  }

  /**
   * Create initial state for a relay
   */
  private createInitialState(url: string): RelayState {
    return {
      url,
      connectionState: "disconnected",
      authStatus: "none",
      authPreference: this.authPreferences.get(url),
      notices: [],
      errors: [],
      stats: {
        connectionsCount: 0,
        authAttemptsCount: 0,
        authSuccessCount: 0,
      },
    };
  }

  /**
   * Update relay state based on current observable values
   */
  private updateRelayState(url: string, relay: IRelay) {
    const state = this.relayStates.get(url);
    if (!state) return;

    const now = Date.now();

    // Update connection state
    const wasConnected = state.connectionState === "connected";
    const isConnected = relay.connected;

    if (isConnected && !wasConnected) {
      state.connectionState = "connected";
      state.lastConnected = now;
      state.stats.connectionsCount++;
    } else if (!isConnected && wasConnected) {
      state.connectionState = "disconnected";
      state.lastDisconnected = now;
      // Reset auth status when disconnecting
      console.log(
        `[RelayStateManager] ${url} disconnected, resetting auth status`,
      );
      state.authStatus = "none";
      state.currentChallenge = undefined;
    } else if (isConnected) {
      state.connectionState = "connected";
    } else {
      state.connectionState = "disconnected";
    }

    // Update auth status
    const challenge = relay.challenge;
    // Use the getter property instead of observable value
    const isAuthenticated = relay.authenticated;

    if (isAuthenticated === true) {
      // Successfully authenticated - this takes priority over everything
      if (state.authStatus !== "authenticated") {
        console.log(
          `[RelayStateManager] ${url} authenticated (was: ${state.authStatus})`,
        );
        state.authStatus = "authenticated";
        state.lastAuthenticated = now;
        state.stats.authSuccessCount++;
      }
      state.currentChallenge = undefined;
    } else if (challenge) {
      // Challenge received
      if (state.authStatus !== "authenticating") {
        // Only update to challenge_received if not already authenticating
        if (
          !state.currentChallenge ||
          state.currentChallenge.challenge !== challenge
        ) {
          console.log(`[RelayStateManager] ${url} challenge received`);
          state.currentChallenge = {
            challenge,
            receivedAt: now,
          };

          // Check if we should auto-authenticate
          const preference = this.authPreferences.get(url);
          if (preference === "always") {
            console.log(
              `[RelayStateManager] ${url} has "always" preference, auto-authenticating`,
            );
            state.authStatus = "authenticating";
            // Trigger authentication asynchronously
            this.authenticateRelay(url).catch((error) => {
              console.error(
                `[RelayStateManager] Auto-auth failed for ${url}:`,
                error,
              );
            });
          } else {
            state.authStatus = "challenge_received";
          }
        }
      }
      // If we're authenticating and there's still a challenge, keep authenticating status
    } else {
      // No challenge and not authenticated
      if (state.currentChallenge || state.authStatus === "authenticating") {
        // Challenge was cleared or authentication didn't result in authenticated status
        if (state.authStatus === "authenticating") {
          // Authentication failed
          console.log(
            `[RelayStateManager] ${url} auth failed - no challenge and not authenticated`,
          );
          state.authStatus = "failed";
        } else if (state.authStatus === "challenge_received") {
          // Challenge was dismissed/rejected
          console.log(`[RelayStateManager] ${url} challenge rejected`);
          state.authStatus = "rejected";
        }
        state.currentChallenge = undefined;
      }
    }

    // Add notices (bounded array)
    const notices = relay.notices;
    if (notices.length > 0) {
      const notice = notices[0];
      const lastNotice = state.notices[0];
      if (!lastNotice || lastNotice.message !== notice) {
        state.notices.unshift({ message: notice, timestamp: now });
        if (state.notices.length > MAX_NOTICES) {
          state.notices = state.notices.slice(0, MAX_NOTICES);
        }
      }
    }

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get auth preference for a relay
   */
  async getAuthPreference(
    relayUrl: string,
  ): Promise<AuthPreference | undefined> {
    // Check memory cache first
    if (this.authPreferences.has(relayUrl)) {
      return this.authPreferences.get(relayUrl);
    }

    // Load from database
    const record = await db.relayAuthPreferences.get(relayUrl);
    if (record) {
      this.authPreferences.set(relayUrl, record.preference);
      return record.preference;
    }

    return undefined;
  }

  /**
   * Set auth preference for a relay
   */
  async setAuthPreference(relayUrl: string, preference: AuthPreference) {
    console.log(
      `[RelayStateManager] Setting auth preference for ${relayUrl} to "${preference}"`,
    );

    // Update memory cache
    this.authPreferences.set(relayUrl, preference);

    // Save to database
    try {
      await db.relayAuthPreferences.put({
        url: relayUrl,
        preference,
        updatedAt: Date.now(),
      });
      console.log(
        `[RelayStateManager] Successfully saved preference to database`,
      );
    } catch (error) {
      console.error(
        `[RelayStateManager] Failed to save preference to database:`,
        error,
      );
      throw error;
    }

    // Update relay state
    const state = this.relayStates.get(relayUrl);
    if (state) {
      state.authPreference = preference;
      this.notifyListeners();
      console.log(
        `[RelayStateManager] Updated relay state and notified listeners`,
      );
    }
  }

  /**
   * Authenticate with a relay
   */
  async authenticateRelay(relayUrl: string): Promise<void> {
    const relay = pool.relay(relayUrl);
    const state = this.relayStates.get(relayUrl);

    if (!relay || !state) {
      throw new Error(`Relay ${relayUrl} not found`);
    }

    if (!state.currentChallenge) {
      throw new Error(`No auth challenge for ${relayUrl}`);
    }

    // Get active account
    const account = accountManager.active;
    if (!account) {
      throw new Error("No active account to authenticate with");
    }

    // Update status to authenticating
    state.authStatus = "authenticating";
    state.stats.authAttemptsCount++;
    this.notifyListeners();

    try {
      console.log(`[RelayStateManager] Authenticating with ${relayUrl}...`);
      console.log(
        `[RelayStateManager] Before auth - authenticated = ${relay.authenticated}, challenge = ${relay.challenge}`,
      );
      await relay.authenticate(account);
      console.log(
        `[RelayStateManager] After auth - authenticated = ${relay.authenticated}, challenge = ${relay.challenge}`,
      );

      // Wait a bit for the observable to update
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log(
        `[RelayStateManager] After delay - authenticated = ${relay.authenticated}, challenge = ${relay.challenge}`,
      );

      // Force immediate state update after authentication
      this.updateRelayState(relayUrl, relay);
    } catch (error) {
      state.authStatus = "failed";
      state.errors.unshift({
        message: `Auth failed: ${error}`,
        timestamp: Date.now(),
      });
      if (state.errors.length > MAX_ERRORS) {
        state.errors = state.errors.slice(0, MAX_ERRORS);
      }
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Reject authentication for a relay
   */
  rejectAuth(relayUrl: string, rememberForSession = true) {
    const state = this.relayStates.get(relayUrl);
    if (state) {
      state.authStatus = "rejected";
      state.currentChallenge = undefined;
      if (rememberForSession) {
        this.sessionRejections.add(relayUrl);
      }
      this.notifyListeners();
    }
  }

  /**
   * Check if a relay should be prompted for auth
   */
  shouldPromptAuth(relayUrl: string): boolean {
    // Check permanent preferences
    const pref = this.authPreferences.get(relayUrl);
    if (pref === "never") return false;

    // Check session rejections
    if (this.sessionRejections.has(relayUrl)) return false;

    // Don't prompt if already authenticated (unless challenge changes)
    const state = this.relayStates.get(relayUrl);
    if (state?.authStatus === "authenticated") return false;

    return true;
  }

  /**
   * Get current global state
   */
  getState(): GlobalRelayState {
    const relays: Record<string, RelayState> = {};
    this.relayStates.forEach((state, url) => {
      relays[url] = state;
    });

    const pendingChallenges = Array.from(this.relayStates.values())
      .filter(
        (state) =>
          state.authStatus === "challenge_received" &&
          this.shouldPromptAuth(state.url),
      )
      .map((state) => ({
        relayUrl: state.url,
        challenge: state.currentChallenge!.challenge,
        receivedAt: state.currentChallenge!.receivedAt,
      }));

    const authPreferences: Record<string, AuthPreference> = {};
    this.authPreferences.forEach((pref, url) => {
      authPreferences[url] = pref;
    });

    return {
      relays,
      pendingChallenges,
      authPreferences,
    };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: GlobalRelayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  /**
   * Load auth preferences from database into memory cache
   */
  private async loadAuthPreferences() {
    try {
      const allPrefs = await db.relayAuthPreferences.toArray();
      allPrefs.forEach((record) => {
        this.authPreferences.set(record.url, record.preference);
      });
      console.log(
        `[RelayStateManager] Loaded ${allPrefs.length} auth preferences from database`,
      );
    } catch (error) {
      console.warn("Failed to load auth preferences:", error);
    }
  }

  /**
   * Cleanup all subscriptions
   */
  destroy() {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions.clear();
    this.listeners.clear();
  }
}

// Singleton instance
const relayStateManager = new RelayStateManager();

export default relayStateManager;
