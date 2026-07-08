import { useGetPortalOverview, useCreateBillingSession, useGetMe } from "@workspace/api-client-react";
import PortalLayout from "./PortalLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KeyIcon, CreditCard, Users as UsersIcon, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: me } = useGetMe();
  const { data: overview, isLoading, isError } = useGetPortalOverview();
  const createBillingSession = useCreateBillingSession();
  const [copied, setCopied] = useState(false);

  const isAdmin = me?.role === 'admin';

  const handleManageBilling = async () => {
    try {
      const res = await createBillingSession.mutateAsync();
      window.location.href = res.url;
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyLicense = () => {
    if (overview?.license.key) {
      navigator.clipboard.writeText(overview.license.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'paused': return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'cancelled': return <AlertCircle className="w-5 h-5 text-destructive" />;
      default: return null;
    }
  };

  return (
    <PortalLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">Manage your company's RentNotice Pro license and subscription.</p>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-6">
          <Skeleton className="h-[250px]" />
          <Skeleton className="h-[250px]" />
        </div>
      ) : isError || !overview ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Failed to load dashboard overview. Please try again later.</AlertDescription>
        </Alert>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 items-start">
          
          {/* License Card */}
          <Card className="border-primary/10 shadow-sm relative overflow-hidden">
            <div className={`absolute top-0 w-full h-1 ${overview.license.status === 'active' ? 'bg-green-500' : overview.license.status === 'paused' ? 'bg-yellow-500' : 'bg-destructive'}`}></div>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <KeyIcon className="w-5 h-5 text-primary" />
                  License Key
                </CardTitle>
                <div className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full text-xs font-medium capitalize border">
                  {getStatusIcon(overview.license.status)}
                  {overview.license.status}
                </div>
              </div>
              <CardDescription>{overview.license.statusReason}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Your Key</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted/50 p-2.5 rounded border border-border/50 text-sm break-all font-semibold">
                    {overview.license.key}
                  </code>
                  <Button variant="secondary" size="sm" onClick={handleCopyLicense} className="shrink-0 h-10">
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/20 p-3 rounded-md border border-border/50">
                <div>
                  <span className="text-muted-foreground block mb-1">Activated</span>
                  <span className="font-medium">{overview.license.activatedAt ? format(new Date(overview.license.activatedAt), 'MMM d, yyyy') : 'Not yet'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">Last Verified</span>
                  <span className="font-medium">{overview.license.lastVerifiedAt ? format(new Date(overview.license.lastVerifiedAt), 'MMM d, yyyy') : 'Never'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Subscription Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Subscription
              </CardTitle>
              <CardDescription>Your current billing plan details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex justify-between items-end border-b pb-4">
                <div>
                  <div className="text-2xl font-bold text-foreground">{overview.subscription.tierName}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {overview.subscription.priceMonthlyCents ? `$${(overview.subscription.priceMonthlyCents/100).toFixed(2)}/mo` : 'Custom Pricing'}
                  </div>
                </div>
                {overview.subscription.status === 'active' ? (
                   <span className="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-1 rounded-full dark:bg-green-900/30 dark:text-green-400">Active</span>
                ) : (
                  <span className="bg-muted text-muted-foreground text-xs font-semibold px-2.5 py-1 rounded-full capitalize">{overview.subscription.status}</span>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground flex items-center gap-2"><UsersIcon className="w-4 h-4"/> Seats</span>
                  <span className="font-medium">{overview.seatsUsed} / {overview.subscription.seats}</span>
                </div>
                
                {overview.subscription.currentPeriodEnd && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {overview.subscription.cancelAtPeriodEnd ? 'Cancels on' : 'Renews on'}
                    </span>
                    <span className="font-medium">{format(new Date(overview.subscription.currentPeriodEnd), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </CardContent>
            {isAdmin && (
              <CardFooter className="pt-0">
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleManageBilling} 
                  disabled={createBillingSession.isPending}
                >
                  {createBillingSession.isPending ? "Redirecting..." : "Manage Billing & Payment"}
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      )}
    </PortalLayout>
  );
}
