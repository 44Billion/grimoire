import { useEffect, useState } from "react";
import walletService from "@/services/wallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Wallet, AlertCircle, CheckCircle2 } from "lucide-react";

export function WalletViewer() {
  const [status, setStatus] = useState(walletService.status$.value);
  const [error, setError] = useState<Error | null>(null);
  const [uri, setUri] = useState("");
  const [invoice, setInvoice] = useState("");
  const [paymentResult, setPaymentResult] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    const subStatus = walletService.status$.subscribe(setStatus);
    const subError = walletService.error$.subscribe(setError);
    return () => {
      subStatus.unsubscribe();
      subError.unsubscribe();
    };
  }, []);

  const handleConnect = async () => {
    if (!uri) return;
    try {
      await walletService.connect(uri);
    } catch (e) {
      // Error is handled by subscription
    }
  };

  const handleDisconnect = () => {
    walletService.disconnect();
    setUri("");
    setPaymentResult(null);
  };

  const handlePay = async () => {
    if (!invoice) return;
    setIsPaying(true);
    setPaymentResult(null);
    try {
      const preimage = await walletService.payInvoice(invoice);
      setPaymentResult(preimage || "Payment successful (no preimage returned)");
      setInvoice("");
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Payment failed"));
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <Wallet className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Nostr Wallet Connect</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {status === "disconnected" && (
        <Card>
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
            <CardDescription>
              Enter your Nostr Wallet Connect (NWC) connection string.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="nostr+walletconnect://..."
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                type="password"
              />
              <p className="text-xs text-muted-foreground">
                Your connection string is stored locally in your browser.
              </p>
            </div>
            <Button onClick={handleConnect} disabled={!uri} className="w-full">
              Connect
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "connecting" && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Connecting to wallet...</p>
          </CardContent>
        </Card>
      )}

      {status === "connected" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Connected
              </CardTitle>
              <CardDescription>
                Your wallet is connected and ready to make payments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pay Invoice</CardTitle>
              <CardDescription>
                Paste a Lightning invoice (bolt11) to pay.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="lnbc..."
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                />
                <Button onClick={handlePay} disabled={!invoice || isPaying}>
                  {isPaying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Pay"
                  )}
                </Button>
              </div>
              
              {paymentResult && (
                <Alert className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertTitle className="text-green-800 dark:text-green-200">Payment Successful</AlertTitle>
                  <AlertDescription className="text-green-700 dark:text-green-300 break-all font-mono text-xs mt-1">
                    Preimage: {paymentResult}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
