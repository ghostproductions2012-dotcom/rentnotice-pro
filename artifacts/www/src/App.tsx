import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/Home";
import Download from "@/pages/Download";
import Pricing from "@/pages/Pricing";
import Signup from "@/pages/Signup";
import Login from "@/pages/Login";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import Dashboard from "@/pages/portal/Dashboard";
import Users from "@/pages/portal/Users";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminCompanyDetail from "@/pages/admin/AdminCompanyDetail";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/download" component={Download} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/signup" component={Signup} />
      <Route path="/login" component={Login} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
