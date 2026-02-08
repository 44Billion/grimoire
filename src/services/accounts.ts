import { AccountManager } from "applesauce-accounts";
import {
  registerCommonAccountTypes,
  ExtensionAccount,
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

// Auto-login with NIP-07 peekPublicKey
async function checkAutoLogin() {
  const nostr = (window as any).nostr;
  if (nostr?.peekPublicKey) {
    try {
      const pubkey = await nostr.peekPublicKey();
      if (pubkey && typeof pubkey === "string") {
        // Find if we already have this account
        let account = accountManager.accounts.find(
          (a) => a.pubkey === pubkey && a.type === "extension",
        );

        if (!account) {
          // If not, create it
          account = new ExtensionAccount(pubkey, new ExtensionSigner());
          accountManager.addAccount(account);
        }

        if (accountManager.active?.id !== account.id) {
          accountManager.setActive(account);
          console.log(
            `[Auto-Login] Active account set to ${pubkey} via peekPublicKey`,
          );
        }
      }
    } catch (err) {
      // Ignore errors from peekPublicKey
    }
  }
}

checkAutoLogin();

export default accountManager;
