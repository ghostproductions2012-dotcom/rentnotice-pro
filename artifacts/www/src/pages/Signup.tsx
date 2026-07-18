import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useStartCheckout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useLocation } from "wouter";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";

const formSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  adminName: z.string().min(1, "Admin name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  tier: z.string().min(1, "Tier is required"),
});

export default function Signup() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const tier = searchParams.get("tier") || "starter";
  
  const [errorMsg, setErrorMsg] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      companyName: "",
      adminName: "",
      email: "",
      password: "",
      tier: tier,
    },
  });

  const startCheckout = useStartCheckout();

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setErrorMsg("");
    try {
      const response = await startCheckout.mutateAsync({ data: values });
      window.location.href = response.url;
    } catch (error: any) {
      if (error?.status === 503) {
        setErrorMsg("Payments are currently being set up. Please try again later.");
      } else {
        setErrorMsg(error?.error || "Failed to start checkout");
      }
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/30">
      <Seo
        title={ROUTE_SEO["/signup"].title}
        description={ROUTE_SEO["/signup"].description}
        path="/signup"
        noindex
      />
      <div className="bg-background border-b">
        <SiteHeader />
      </div>
      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md bg-card p-6 sm:p-8 rounded-xl shadow-sm border border-border">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-serif text-foreground">Create your account</h2>
          <p className="text-muted-foreground mt-2">Start your subscription to RentNotice Pro</p>
        </div>

        {errorMsg && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input placeholder="Acme Property Management" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="adminName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Name</FormLabel>
                  <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work Email</FormLabel>
                  <FormControl><Input type="email" placeholder="jane@acmeproperties.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl><Input type="password" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <input type="hidden" {...form.register("tier")} />
            
            <Button type="submit" className="w-full mt-6" size="lg" disabled={startCheckout.isPending}>
              {startCheckout.isPending ? "Starting checkout..." : "Continue to Payment"}
            </Button>
          </form>
        </Form>
      </div>
      </div>
    </div>
  );
}
