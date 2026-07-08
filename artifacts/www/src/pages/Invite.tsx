import { useGetInvite, useAcceptInvite, getGetMeQueryKey, getGetInviteQueryKey } from "@workspace/api-client-react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2 } from "lucide-react";

const acceptSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export default function Invite() {
  const params = useParams();
  const token = params.token || "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState("");

  const { data: invite, isLoading, isError } = useGetInvite(token, {
    query: { enabled: !!token, retry: false, queryKey: getGetInviteQueryKey(token) }
  });

  const acceptMutation = useAcceptInvite();

  const form = useForm<z.infer<typeof acceptSchema>>({
    resolver: zodResolver(acceptSchema),
    defaultValues: { name: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof acceptSchema>) {
    setErrorMsg("");
    try {
      await acceptMutation.mutateAsync({ 
        data: { token, name: values.name, password: values.password } 
      });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocation("/portal");
    } catch (e: any) {
      setErrorMsg(e?.error || "Failed to accept invitation. The link may have expired.");
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Skeleton className="h-8 w-3/4 mb-2" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md border-destructive/20">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl text-destructive font-serif">Invalid Invitation</CardTitle>
            <CardDescription className="text-base mt-2">
              This invitation link is invalid, has expired, or has already been used.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="outline" onClick={() => setLocation("/login")}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-muted/30 p-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-serif font-bold text-primary tracking-tight">RentNotice Pro</h1>
      </div>

      <Card className="w-full max-w-md shadow-lg border-primary/10">
        <CardHeader className="text-center pb-6 border-b bg-muted/20">
          <div className="mx-auto w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
            <Building2 className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-serif">Join your team</CardTitle>
          <CardDescription className="text-base mt-2">
            You've been invited to join <strong>{invite.companyName}</strong> as a <span className="capitalize font-medium">{invite.role}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {errorMsg && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium">Email Address</label>
                <Input value={invite.email} disabled className="bg-muted text-muted-foreground" />
                <p className="text-xs text-muted-foreground">This will be your login email.</p>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Create Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button type="submit" className="w-full mt-6" size="lg" disabled={acceptMutation.isPending}>
                {acceptMutation.isPending ? "Creating account..." : "Accept Invitation & Join"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
