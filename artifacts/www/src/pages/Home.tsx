import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";
import SiteFooter from "@/components/SiteFooter";
import PromoVideo from "@/components/PromoVideo";
import { motion } from "framer-motion";
import { ShieldCheck, Calculator, Clock, Smartphone, ChevronRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/"].title}
        description={ROUTE_SEO["/"].description}
        path=""
      />
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        {/* Hero Section */}
        <section className="relative pt-24 pb-32 px-4 sm:px-8 overflow-hidden flex flex-col items-center">
          {/* Abstract background gradient */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none opacity-50 z-20" />
          
          <div className="max-w-5xl mx-auto text-center flex flex-col items-center gap-8 relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-primary/30 bg-primary/10 text-primary"
            >
              Pay-or-Quit Notices for All 50 States + DC
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-5xl sm:text-6xl md:text-8xl font-serif text-foreground leading-[1.05] tracking-tight"
            >
              Eviction notices that <br/>
              <span className="text-gradient italic">hold up in court.</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg md:text-2xl text-muted-foreground max-w-2xl leading-relaxed"
            >
              The #1 cause of lost eviction cases is an incorrectly calculated notice amount. Turn the highest-risk legal chore in property management into a defensible, error-free workflow.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="w-full mt-4"
            >
              <PromoVideo />
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mt-2 w-full sm:w-auto"
            >
              <Link href="/pricing" className="bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-bold hover:bg-primary/90 transition-all shadow-[0_0_30px_rgba(237,187,82,0.2)] hover:shadow-[0_0_40px_rgba(237,187,82,0.4)] hover:-translate-y-0.5 duration-300 text-center flex items-center justify-center gap-2">
                See Pricing & Plans
                <ChevronRight className="w-5 h-5" />
              </Link>
              <Link href="/download" className="border border-white/20 bg-white/5 backdrop-blur-sm text-foreground px-8 py-4 rounded-md text-lg font-semibold hover:bg-white/10 transition-all text-center">
                Download Desktop App
              </Link>
            </motion.div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="py-24 px-4 sm:px-8 bg-background">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl md:text-5xl font-serif mb-6 text-foreground">A unified chain of custody from ledger to court.</h2>
              <p className="text-xl text-muted-foreground">We eliminated the manual entry, the math errors, and the process server delays.</p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                {
                  icon: Calculator,
                  title: "Rent-Only Isolation",
                  desc: "Automatically strips late fees, utilities, and deposits so your demand amount reflects rent only — the standard courts in every state expect."
                },
                {
                  icon: ShieldCheck,
                  title: "Auditable Calculations",
                  desc: "Generates a complete calculation review showing every exclusion and partial payment for court defense."
                },
                {
                  icon: Clock,
                  title: "Deadline Math",
                  desc: "State-specific notice periods and court holiday calendars automatically calculate the exact expiration date."
                },
                {
                  icon: Smartphone,
                  title: "Field App Evidence",
                  desc: "Process servers capture GPS-tagged, timestamped photo evidence synced instantly to your desktop."
                }
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="p-8 rounded-xl bg-white/5 border border-white/10 hover:border-primary/50 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center mb-6 text-primary group-hover:scale-110 transition-transform">
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3 text-foreground">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Social Proof / Integration */}
        <section className="py-24 px-4 sm:px-8 border-y border-white/5 bg-white/[0.02]">
          <div className="max-w-5xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-serif mb-8 text-foreground">Seamlessly integrates with your workflow</h2>
            <div className="p-8 md:p-12 rounded-2xl border border-white/10 bg-background shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
              <p className="text-2xl md:text-3xl font-serif leading-snug mb-8">
                Import your properties, tenants, and outstanding balances from Buildium in one click and generate notices instantly — while Slack and Google Chat keep your whole team in the loop.
              </p>
              <Link href="/integrations" className="text-primary font-semibold hover:text-primary/80 flex items-center justify-center gap-2">
                Explore integrations <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-32 px-4 sm:px-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-primary/5" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-4xl md:text-6xl font-serif mb-6 text-foreground tracking-tight">Stop risking your evictions on manual math.</h2>
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Equip your property management team with notice software covering all 50 states and DC — including attorney-reviewed California templates, plus built-in starting points for every other state.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/pricing" className="bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-bold hover:bg-primary/90 transition-all shadow-xl hover:-translate-y-0.5 duration-300">
                Start Your Free Trial
              </Link>
              <Link href="/how-it-works" className="text-foreground font-semibold hover:text-primary px-8 py-4 transition-colors">
                See How It Works
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
