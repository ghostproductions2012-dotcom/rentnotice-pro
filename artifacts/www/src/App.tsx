import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Features from "@/pages/Features";
import HowItWorks from "@/pages/HowItWorks";
import Integrations from "@/pages/Integrations";
import FAQ from "@/pages/FAQ";
import Coverage from "@/pages/Coverage";
import Download from "@/pages/Download";
import Pricing from "@/pages/Pricing";
import Signup from "@/pages/Signup";
import Login from "@/pages/Login";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import Guidelines from "@/pages/Guidelines";
import Support from "@/pages/Support";
import Dashboard from "@/pages/portal/Dashboard";
import Users from "@/pages/portal/Users";
import AttorneyCase from "@/pages/AttorneyCase";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminCompanyDetail from "@/pages/admin/AdminCompanyDetail";

const queryClient = new QueryClient();

let isBackForwardNavigation = false;

function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "auto";
    }
    const onPopState = () => {
      isBackForwardNavigation = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isBackForwardNavigation) {
      isBackForwardNavigation = false;
      return;
    }
    const hash = window.location.hash;
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [location]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/features" component={Features} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/faq" component={FAQ} />
      <Route path="/coverage" component={Coverage} />
      <Route path="/download" component={Download} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/guidelines" component={Guidelines} />
      <Route path="/support" component={Support} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/attorney/:token" component={AttorneyCase} />
      <Route path="/portal" component={Dashboard} />
      <Route path="/portal/users" component={Users} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/companies/:companyId" component={AdminCompanyDetail} />
      <Route path="/www/*?">
        {(params) => <Redirect to={`/${params["*"] ?? ""}`} replace />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ScrollToTop />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
