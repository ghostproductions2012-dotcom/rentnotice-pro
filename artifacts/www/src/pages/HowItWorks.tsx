import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";
import SiteFooter from "@/components/SiteFooter";
import { motion } from "framer-motion";
import { 
  FileUp, Filter, CalendarDays, 
  CheckCircle2, Camera, Scale
} from "lucide-react";

export default function HowItWorks() {
  const steps = [
    {
      icon: FileUp,
      title: "1. Import the Ledger",
      desc: "Upload a PDF, Excel, or CSV statement. Our system extracts the transactions, or automatically pulls them via the Buildium integration. Manual entry is also supported."
    },
    {
      icon: Filter,
      title: "2. Isolate Valid Rent",
      desc: "The engine instantly flags and isolates late fees, utilities, and arbitrary deposits. It calculates the exact rent demand amount using your state's notice rules and statutory citations."
    },
    {
      icon: CalendarDays,
      title: "3. Compute the Deadlines",
      desc: "Based on the date of service, the built-in court holiday calendar excludes weekends and state holidays to determine the exact expiration date for the tenant."
    },
    {
      icon: CheckCircle2,
      title: "4. Finalize & Dispatch",
      desc: "Review the generated audit summary. Once approved, the PDF is locked, watermarked, and dispatched to the field app as an active assignment."
    },
    {
      icon: Camera,
      title: "5. Field Execution",
      desc: "Process servers perform personal, substitute, or post-and-mail service. They capture offline-capable, GPS-tagged, and timestamped photos that sync instantly."
    },
    {
      icon: Scale,
      title: "6. Court-Ready Output",
      desc: "Download the complete, defensible packet. You now have a flawless notice, an auditable math trail, and indisputable proof of service ready for your attorney."
    }
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/how-it-works"].title}
        description={ROUTE_SEO["/how-it-works"].description}
        path="/how-it-works"
      />
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="relative pt-24 pb-20 px-4 sm:px-8 border-b border-white/5">
          <div className="max-w-4xl mx-auto text-center">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl sm:text-6xl md:text-7xl font-serif text-foreground leading-[1.1] tracking-tight mb-6"
            >
              How Pay-or-Quit Notice <br className="hidden sm:block"/>
              <span className="text-gradient italic">Software Works</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
            >
              The unbroken chain of custody. See how RentNotice Pro transforms a messy, high-risk manual chore into a systematic, court-ready workflow.
            </motion.p>
          </div>
        </section>

        {/* Steps */}
        <section className="py-24 px-4 sm:px-8 relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/5 hidden md:block" />
          
          <div className="max-w-5xl mx-auto">
            {steps.map((step, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5 }}
                className={`relative flex flex-col md:flex-row gap-8 md:gap-16 items-center mb-24 last:mb-0 ${
                  i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                {/* Timeline node */}
                <div className="absolute left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-primary hidden md:block shadow-[0_0_15px_rgba(237,187,82,0.5)]" />

                <div className={`flex-1 w-full text-center md:text-left ${i % 2 === 0 ? "md:text-right" : ""}`}>
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-xl bg-white/5 border border-white/10 text-primary mb-6 ${i % 2 === 0 ? "md:ml-auto" : ""}`}>
                    <step.icon className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl md:text-3xl font-serif text-foreground mb-4">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-lg">{step.desc}</p>
                </div>
                
                <div className="flex-1 w-full">
                  <div className="aspect-[4/3] rounded-2xl bg-secondary/30 border border-white/5 flex items-center justify-center p-8">
                    {/* Abstract representation of the step */}
                    <div className="w-full h-full border border-white/10 rounded-lg bg-background/50 flex flex-col items-center justify-center gap-4 relative overflow-hidden">
                       <div className="absolute inset-0 bg-primary/5 opacity-0 hover:opacity-100 transition-opacity duration-500" />
                       <step.icon className="w-16 h-16 text-primary/40" />
                       <div className="w-1/2 h-2 bg-white/10 rounded-full" />
                       <div className="w-1/3 h-2 bg-white/10 rounded-full" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-4 sm:px-8 bg-white/[0.02] border-t border-white/5 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-5xl font-serif mb-8 text-foreground">Stop guessing. Start proving.</h2>
            <Link href="/pricing" className="inline-block bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-bold hover:bg-primary/90 transition-all shadow-xl hover:-translate-y-0.5 duration-300">
              Start Free Trial
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}