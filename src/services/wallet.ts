import { WalletConnect } from "applesauce-wallet-connect";
import { BehaviorSubject } from "rxjs";

const WALLET_CONNECT_URI = "nostr-wallet-connect-uri";

class WalletService {
  public wallet: WalletConnect | null = null;
  public status$ = new BehaviorSubject<"connected" | "disconnected" | "connecting">("disconnected");
  public error$ = new BehaviorSubject<Error | null>(null);

  constructor() {
    this.restoreConnection();
  }

  private async restoreConnection() {
    const uri = localStorage.getItem(WALLET_CONNECT_URI);
    if (uri) {
      await this.connect(uri);
    }
  }

  public async connect(uri: string) {
    try {
      this.status$.next("connecting");
      this.error$.next(null);

      // Create new wallet instance
      this.wallet = WalletConnect.fromConnectURI(uri);
      
      // Save URI for auto-reconnect
      localStorage.setItem(WALLET_CONNECT_URI, uri);
      
      this.status$.next("connected");
      return this.wallet;
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      this.error$.next(err instanceof Error ? err : new Error("Unknown error"));
      this.status$.next("disconnected");
      this.wallet = null;
      throw err;
    }
  }

  public disconnect() {
    this.wallet = null;
    localStorage.removeItem(WALLET_CONNECT_URI);
    this.status$.next("disconnected");
  }

  public async payInvoice(invoice: string): Promise<string | undefined> {
    if (!this.wallet) {
      throw new Error("Wallet not connected");
    }
    const response = await this.wallet.payInvoice(invoice);
    return response.preimage;
  }
}

const walletService = new WalletService();
export default walletService;
