import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";
import SiteFooter from "@/components/SiteFooter";
import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function FAQ() {
  const faqs = [
    {
      question: "Is RentNotice Pro considered legal advice?",
      answer: "No. RentNotice Pro is a software tool that calculates and formats pay-or-quit notices for all 50 states and DC. California templates are attorney-reviewed; templates for other states are generic starting points that are not attorney-reviewed. The software automates math and formatting, but does not substitute for the counsel of an attorney. We always recommend having your attorney review final notices before service."
    },
    {
      question: "Where is my tenant data stored?",
      answer: "RentNotice Pro is built with a local-first architecture. The desktop application stores your sensitive tenant data, property information, and ledgers locally on your machine. We do not aggregate or sell your proprietary management data."
    },
    {
      question: "How does team licensing work?",
      answer: "We offer seat-based team licensing. Administrators can purchase seats and send email invitations from the portal. Roles can be assigned (Admin vs. User) to restrict who can finalize documents or manage billing."
    },
    {
      question: "What platforms does the software support?",
      answer: "The desktop application is available for Mac, Windows, and Linux. The companion field application for process servers is available on mobile devices via web and progressive web app functionality."
    },
    {
      question: "How does the built-in court calendar work?",
      answer: "Many states prohibit eviction notices from expiring on weekends or judicial holidays. Our engine applies state-specific notice periods and court holiday calendars — with the deepest coverage for California, including a rigorously maintained calendar of California state court holidays. When you select a date of service, it automatically skips invalid days to determine the correct expiration date."
    },
    {
      question: "Can I cancel my subscription at any time?",
      answer: "Yes. You can manage your billing, update payment methods, or cancel your subscription at any time through our self-serve Stripe billing portal."
    }
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/faq"].title}
        description={ROUTE_SEO["/faq"].description}
        path="/faq"
      />
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="pt-24 pb-16 px-4 sm:px-8 border-b border-white/5">
          <div className="max-w-3xl mx-auto text-center">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl sm:text-6xl font-serif text-foreground leading-[1.1] tracking-tight mb-6"
            >
              Frequently asked <br />
              <span className="text-gradient italic">questions.</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground"
            >
              Everything you need to know about compliance, data privacy, and deployment.
            </motion.p>
          </div>
        </section>

        {/* FAQ Content */}
        <section className="py-24 px-4 sm:px-8">
          <div className="max-w-3xl mx-auto">
            <Accordion type="single" collapsible className="w-full space-y-4">
              {faqs.map((faq, i) => (
                <AccordionItem 
                  key={i} 
                  value={`item-${i}`}
                  className="bg-white/[0.02] border border-white/10 rounded-lg px-6 data-[state=open]:border-primary/30 transition-colors"
                >
                  <AccordionTrigger className="text-left text-lg font-semibold hover:no-underline hover:text-primary transition-colors py-6">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Support CTA */}
        <section className="py-24 px-4 sm:px-8 text-center bg-white/[0.02] border-t border-white/5">
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-serif text-foreground mb-4">Still have questions?</h2>
            <p className="text-muted-foreground mb-8">
              Our team is ready to help you evaluate if RentNotice Pro is the right fit for your portfolio.
            </p>
            <Link href="/pricing" className="inline-block border border-white/20 bg-background text-foreground px-8 py-3 rounded-md font-semibold hover:bg-white/5 transition-colors">
              Contact Sales
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}