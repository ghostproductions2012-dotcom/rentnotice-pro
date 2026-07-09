import { useCompleteCheckout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Copy, Check, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function CheckoutSuccess() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("session_id");
  const queryClient = useQueryClient();
  const completeCheckout = useCompleteCheckout();
  
  const [copied, setCopied] = useState(false);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setLocation("/pricing");
      return;
    }

    if (!hasRun.current) {
      hasRun.current = true;
      completeCheckout.mutate({ data: { sessionId } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        }
      });
    }
  }, [sessionId, setLocation, completeCheckout, queryClient]);

  const handleCopy = () => {
    if (completeCheckout.data?.licenseKey) {
      navigator.clipboard.writeText(completeCheckout.data.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!sessionId) return null;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 py-12 px-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
            <Check className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-serif text-foreground mb-4">Subscription Confirmed!</h1>
          <p className="text-xl text-muted-foreground">
            Thank you for choosing RentNotice Pro. You're ready to get started.
          </p>
        </div>

        <Card className="border-primary/20 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
          <CardHeader className="pb-4 border-b">
            <CardTitle>Your License Key</CardTitle>
            <CardDescription>
              {completeCheckout.isPending ? "Generating your license..." : 
               completeCheckout.data ? `Provisioned for ${completeCheckout.data.companyName}` : "Retrieving your license..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {completeCheckout.isPending ? (
              <div className="space-y-4">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : completeCheckout.isError ? (
              <div className="text-destructive font-medium p-4 bg-destructive/10 rounded-md border border-destructive/20">
                Failed to retrieve license. Please contact support or go to your portal.
              </div>
            ) : completeCheckout.data ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-muted p-4 rounded-md font-mono text-lg tracking-wider border text-center break-all">
                    {completeCheckout.data.licenseKey}
                  </div>
                  <Button variant="outline" size="icon" className="h-14 w-14 shrink-0" onClick={handleCopy}>
                    {copied ? <Check className="h-6 w-6 text-green-600" /> : <Copy className="h-6 w-6" />}
                  </Button>
                </div>
                
                <div className="bg-primary/5 border border-primary/20 rounded-md p-4 space-y-2">
                  <h4 className="font-semibold text-primary">Next Steps:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground ml-1">
                    <li>Download the RentNotice Pro desktop software if you haven't already.</li>
                    <li>Open the application and select "Activate License".</li>
                    <li>Paste the license key above to unlock full functionality.</li>
                  </ol>
                </div>
              </div>
            ) : null}

            <div className="mt-8 flex justify-center">
              <Button size="lg" onClick={() => setLocation("/portal")} className="w-full sm:w-auto">
                Go to Portal <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
