import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";
import SiteFooter from "@/components/SiteFooter";
import { motion } from "framer-motion";
import { 
  FileText, ShieldCheck, Calculator, Clock, 
  Smartphone, MapPin, WifiOff, FileSearch, 
  ChevronRight, ArrowRight
} from "lucide-react";

export default function Features() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/features"].title}
        description={ROUTE_SEO["/features"].description}
        path="/features"
      />
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="relative pt-24 pb-16 px-4 sm:px-8 overflow-hidden flex flex-col items-center">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none opacity-40" />
          
          <div className="max-w-4xl mx-auto text-center flex flex-col items-center gap-6 relative z-10">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl sm:text-5xl md:text-7xl font-serif text-foreground leading-[1.1] tracking-tight"
            >
              Engineered for <br/>
              <span className="text-gradient italic">50-state coverage.</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed"
            >
              From complex ledger isolation to GPS-verified field service. Every feature is designed to eliminate the manual errors that cost property managers their cases.
            </motion.p>
          </div>
        </section>

        {/* Desktop Features */}
        <section className="py-24 px-4 sm:px-8 bg-background relative z-20">
          <div className="max-w-7xl mx-auto">
            <div className="mb-16">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">The Desktop Application</h2>
              <h3 className="text-3xl md:text-5xl font-serif text-foreground">Bulletproof preparation.</h3>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                {
                  icon: FileSearch,
                  title: "Smart Ledger Import",
                  desc: "Import directly from PDF, Excel, or CSV. Built-in OCR extracts transactions automatically. Pre-configured vendor presets for major property management systems."
                },
                {
                  icon: Calculator,
                  title: "Rent-Only Isolation",
                  desc: "Many states demand strict separation of rent from other charges. Automatically strip late fees, utilities, and deposits from the final demand amount to prevent defective notices."
                },
                {
                  icon: Clock,
                  title: "Court Holiday Engine",
                  desc: "State-specific notice periods and court holiday calendars automatically calculate the exact expiration date. Never fail a case due to a weekend or state holiday miscalculation."
                },
                {
                  icon: ShieldCheck,
                  title: "Auditable Calculation Review",
                  desc: "Every notice generates a comprehensive calculation review, detailing exactly which charges were included or excluded, proving your math to the court."
                },
                {
                  icon: FileText,
                  title: "Complete Packet Generation",
                  desc: "Generate watermarked, locked PDF packets containing the notice, proof of service, posting and mailing checklists, and the audit summary."
                },
                {
                  icon: ArrowRight,
                  title: "Lifecycle Tracking",
                  desc: "Track every notice from Draft to Finalized to Sent to Attorney. Maintain a clean, organized system of record stored locally for maximum privacy."
                }
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="p-8 rounded-xl bg-white/5 border border-white/10 hover:border-primary/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-6 text-primary">
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <h4 className="text-xl font-semibold mb-3 text-foreground">{feature.title}</h4>
                  <p className="text-muted-foreground leading-relaxed text-sm md:text-base">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Mobile App Features */}
        <section className="py-24 px-4 sm:px-8 bg-white/[0.02] border-y border-white/5 relative">
          <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 items-center">
            <div className="flex-1 space-y-8">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">The Field Application</h2>
                <h3 className="text-3xl md:text-5xl font-serif text-foreground mb-6">Undeniable proof of service.</h3>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Equip your process servers with a mobile app that leaves no room for doubt. Assignments sync instantly, and evidence is captured with cryptographically secure metadata.
                </p>
              </div>

              <div className="space-y-6">
                {[
                  {
                    icon: MapPin,
                    title: "GPS-Tagged & Timestamped",
                    desc: "Every photo captured in the field embeds precise coordinates and unalterable timestamps, creating a definitive chain of custody."
                  },
                  {
                    icon: Smartphone,
                    title: "Synced Assignments",
                    desc: "Send finalized notices directly to the field app. Servers receive clear instructions for personal, substitute, or post-and-mail service."
                  },
                  {
                    icon: WifiOff,
                    title: "Offline-First Capture",
                    desc: "Serve notices in dead zones or basements. The app captures evidence offline and automatically syncs the moment connectivity is restored."
                  }
                ].map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex gap-4"
                  >
                    <div className="mt-1 w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-foreground mb-1">{item.title}</h4>
                      <p className="text-muted-foreground text-sm md:text-base">{item.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            
            <div className="flex-1 w-full max-w-md lg:max-w-none relative">
              <div className="aspect-[4/5] rounded-2xl bg-gradient-to-tr from-secondary to-background border border-white/10 p-8 shadow-2xl flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10" />
                <div className="relative z-10 w-full max-w-[280px] bg-background border border-white/20 rounded-3xl shadow-2xl overflow-hidden aspect-[9/19] flex flex-col">
                  {/* Mock mobile UI */}
                  <div className="bg-secondary p-4 border-b border-white/10">
                    <div className="h-4 w-1/3 bg-white/20 rounded animate-pulse mb-2" />
                    <div className="h-6 w-2/3 bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="flex-1 p-4 space-y-4">
                    <div className="h-32 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center">
                      <Smartphone className="w-8 h-8 text-white/20" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-3 w-full bg-white/5 rounded" />
                      <div className="h-3 w-5/6 bg-white/5 rounded" />
                      <div className="h-3 w-4/6 bg-white/5 rounded" />
                    </div>
                  </div>
                  <div className="p-4 border-t border-white/10 bg-secondary/50">
                    <div className="h-10 w-full bg-primary/80 rounded-lg" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-32 px-4 sm:px-8 relative overflow-hidden text-center">
          <div className="max-w-3xl mx-auto relative z-10">
            <h2 className="text-4xl md:text-5xl font-serif mb-6 text-foreground">Ready to secure your process?</h2>
            <p className="text-xl text-muted-foreground mb-10">
              Download the desktop application and start preparing court-ready eviction notices today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/pricing" className="bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-bold hover:bg-primary/90 transition-all shadow-[0_0_30px_rgba(237,187,82,0.2)] hover:-translate-y-0.5 duration-300">
                View Plans & Pricing
              </Link>
              <Link href="/download" className="border border-white/20 bg-white/5 backdrop-blur-sm text-foreground px-8 py-4 rounded-md text-lg font-semibold hover:bg-white/10 transition-all">
                Download Now
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}