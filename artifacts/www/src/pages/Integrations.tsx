import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";
import SiteFooter from "@/components/SiteFooter";
import { motion } from "framer-motion";
import { ArrowRight, RefreshCcw, DownloadCloud, Database, CreditCard, Users, Webhook, MessageSquare } from "lucide-react";

export default function Integrations() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/integrations"].title}
        description={ROUTE_SEO["/integrations"].description}
        path="/integrations"
      />
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="relative pt-24 pb-16 px-4 sm:px-8">
          <div className="max-w-5xl mx-auto text-center">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl sm:text-6xl md:text-7xl font-serif text-foreground leading-[1.1] tracking-tight mb-6"
            >
              Connect your data. <br />
              <span className="text-gradient italic">Skip the data entry.</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              RentNotice Pro pulls the exact ledger and tenant data you need directly from your property management system.
            </motion.p>
          </div>
        </section>

        {/* Buildium Feature */}
        <section className="py-24 px-4 sm:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-3xl border border-primary/20 bg-primary/5 p-8 md:p-16 flex flex-col lg:flex-row gap-12 items-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
              
              <div className="flex-1 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-semibold mb-6">
                  <RefreshCcw className="w-4 h-4" />
                  Direct Integration
                </div>
                <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Buildium, fully integrated.</h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                  Connect your Buildium account via API. Pull your properties, tenant rosters, and live ledger balances directly into RentNotice Pro with a single click. No more exporting CSVs or re-typing addresses.
                </p>
                <ul className="space-y-4 mb-8">
                  {[
                    "One-click sync of active properties and units",
                    "Import live tenant names and contact info",
                    "Fetch real-time outstanding ledger balances",
                    "Maintains strict local-first data privacy"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-foreground">
                      <CheckCircleIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex-1 w-full relative z-10">
                <div className="aspect-square max-h-[400px] mx-auto bg-background rounded-2xl border border-white/10 shadow-2xl p-6 flex flex-col justify-center gap-4 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
                  <div className="flex justify-between items-center p-4 border border-white/5 rounded-lg bg-white/5">
                    <span className="font-semibold text-foreground">Property Data</span>
                    <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded">Synced</span>
                  </div>
                  <div className="flex justify-between items-center p-4 border border-white/5 rounded-lg bg-white/5">
                    <span className="font-semibold text-foreground">Tenant Directory</span>
                    <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded">Synced</span>
                  </div>
                  <div className="flex justify-between items-center p-4 border border-primary/30 rounded-lg bg-primary/10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-primary animate-pulse" />
                    <span className="font-semibold text-foreground">Live Ledger Balance</span>
                    <RefreshCcw className="w-4 h-4 text-primary animate-spin" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Slack & Google Chat Feature */}
        <section className="py-24 px-4 sm:px-8 border-t border-white/5">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 md:p-16 flex flex-col lg:flex-row-reverse gap-12 items-center relative overflow-hidden">
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

              <div className="flex-1 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-semibold mb-6">
                  <Webhook className="w-4 h-4" />
                  Team Notifications
                </div>
                <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-6">Slack & Google Chat, in the loop.</h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                  Connect Slack or Google Chat with an incoming webhook, configured right in the desktop app's Settings. Your whole team sees key activity from the communications hub the moment it happens — no one has to open RentNotice Pro to stay informed.
                </p>
                <ul className="space-y-4 mb-8">
                  {[
                    "Get notified when work orders are assigned or completed",
                    "Alert the team the moment a notice is served in the field",
                    "See when tenant emails and announcements go out",
                    "Optionally mirror team chat messages to your channel",
                    "Webhook URLs stored securely in the RentNotice cloud",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-foreground">
                      <CheckCircleIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex-1 w-full relative z-10">
                <div className="aspect-square max-h-[400px] mx-auto bg-background rounded-2xl border border-white/10 shadow-2xl p-6 flex flex-col justify-center gap-4 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
                  <div className="flex items-start gap-3 p-4 border border-white/5 rounded-lg bg-white/5">
                    <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">Notice served</div>
                      <div className="text-xs text-muted-foreground">Unit 4B — 3-Day Notice posted by field agent</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 border border-white/5 rounded-lg bg-white/5">
                    <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">Work order completed</div>
                      <div className="text-xs text-muted-foreground">Leaking faucet — marked done by technician</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 border border-primary/30 rounded-lg bg-primary/10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-primary animate-pulse" />
                    <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">Tenant email sent</div>
                      <div className="text-xs text-muted-foreground">Rent reminder delivered to 12 tenants</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Other integrations / features */}
        <section className="py-24 px-4 sm:px-8 border-t border-white/5">
          <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
              <DownloadCloud className="w-10 h-10 text-primary mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">Universal Exports</h3>
              <p className="text-muted-foreground">
                Don't use Buildium? Our pre-configured vendor presets allow you to import standard Excel or CSV ledger exports from Yardi, AppFolio, and RentManager flawlessly.
              </p>
            </div>
            
            <div className="p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
              <CreditCard className="w-10 h-10 text-primary mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">Stripe Billing</h3>
              <p className="text-muted-foreground">
                Manage your subscription, invoices, and payment methods easily through our integrated Stripe self-serve portal. Clear, transparent billing.
              </p>
            </div>

            <div className="p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
              <Users className="w-10 h-10 text-primary mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-3">Team Licensing</h3>
              <p className="text-muted-foreground">
                Seat-based licensing with email invites and roles. Manage access for your entire property management team from a centralized dashboard.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-4 sm:px-8 text-center bg-primary/5 border-t border-primary/10">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-serif mb-6 text-foreground">Simplify your pipeline.</h2>
            <Link href="/pricing" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-bold hover:bg-primary/90 transition-all shadow-xl hover:-translate-y-0.5 duration-300">
              Start Free Trial <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function CheckCircleIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}