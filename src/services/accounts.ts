import { AccountManager } from "applesauce-accounts";
import {
  ExtensionAccount,
  registerCommonAccountTypes,
} from "applesauce-accounts/accounts";
import { ExtensionSigner, NostrConnectSigner } from "applesauce-signers";
import pool from "./relay-pool";

const ACCOUNTS = "nostr-accounts";
const ACTIVE_ACCOUNT = "active-account";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.error(err);
  }
}

const accountManager = new AccountManager();
registerCommonAccountTypes(accountManager);

// Set up NostrConnectSigner pool BEFORE loading accounts
// This is required for NIP-46 accounts to restore properly
NostrConnectSigner.pool = pool;

// load all accounts
if (localStorage.getItem(ACCOUNTS)) {
  const accounts = localStorage.getItem(ACCOUNTS);
  if (accounts) {
    const json = safeParse(accounts);
    if (json) accountManager.fromJSON(json);
  }
}

// save accounts to localStorage when they change
accountManager.accounts$.subscribe(() => {
  localStorage.setItem(ACCOUNTS, JSON.stringify(accountManager.toJSON()));
});

// load active account
const activeAccountId = localStorage.getItem(ACTIVE_ACCOUNT);
// todo: make sure it's part of accounts
if (activeAccountId) {
  accountManager.setActive(activeAccountId);
}

// save active to localStorage
accountManager.active$.subscribe((account) => {
  if (account) localStorage.setItem(ACTIVE_ACCOUNT, account.id);
  else localStorage.removeItem(ACTIVE_ACCOUNT);
});

let managedLoginPending = false;

async function restoreManagedLogin() {
  if (accountManager.active || managedLoginPending) return;

  const nostr = (window as Window & {
    nostr?: { peekPublicKey?: () => Promise<string | undefined> };
  }).nostr;
  if (typeof nostr?.peekPublicKey !== "function") return;

  managedLoginPending = true;
  try {
    const pubkey = await nostr.peekPublicKey();
    if (!/^[0-9a-f]{64}$/.test(pubkey || "") || accountManager.active) return;

    let account = accountManager.accounts.find(
      (candidate) => candidate.pubkey === pubkey && candidate.type === "extension",
    );
    if (!account) {
      account = new ExtensionAccount(pubkey!, new ExtensionSigner());
      accountManager.addAccount(account);
    }
    accountManager.setActive(account);
  } catch {
    // Silent discovery must not affect the manual login flow.
  } finally {
    managedLoginPending = false;
  }
}

accountManager.active$.subscribe((account) => {
  if (!account) void restoreManagedLogin();
});

export default accountManager;
