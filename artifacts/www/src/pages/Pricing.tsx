import { useListPlans } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <Seo
        title={ROUTE_SEO["/pricing"].title}
        description={ROUTE_SEO["/pricing"].description}
        path="/pricing"
      />
      <SiteHeader />
      <div className="py-12 md:py-24 px-4 sm:px-8 max-w-7xl mx-auto w-full">
        <div className="text-center mb-10 md:mb-16">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif text-foreground mb-4">Simple, transparent pricing</h1>
          <p className="text-xl text-muted-foreground">Choose the plan that fits your property portfolio.</p>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            <Skeleton className="h-[400px]" />
            <Skeleton className="h-[400px]" />
            <Skeleton className="h-[400px]" />
            <Skeleton className="h-[400px]" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {plans?.map((plan) => (
              <Card key={plan.tier} className={`flex flex-col ${plan.highlighted ? 'border-primary shadow-lg md:scale-105 relative z-10 mt-3 md:mt-0' : ''}`}>
                {plan.highlighted && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription className="text-base">{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="mb-6">
                    <span className="text-4xl font-bold">${(plan.priceMonthlyCents / 100).toFixed(plan.priceMonthlyCents % 100 === 0 ? 0 : 2)}</span>
                    <span className="text-muted-foreground">/mo</span>
                  </div>
                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-primary shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Link href={`/signup?tier=${plan.tier}`} className="w-full">
                    <Button className="w-full" variant={plan.highlighted ? "default" : "outline"} size="lg">
                      Get started
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
