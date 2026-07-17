import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <SiteHeader />

      <main className="flex-1 flex flex-col">
        <section className="py-16 md:py-24 px-4 sm:px-8 max-w-5xl mx-auto text-center flex flex-col items-center gap-8">
          <div className="inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-primary/20 bg-primary/5 text-primary">
            Trusted by top property managers
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-serif text-foreground leading-[1.1]">
            Legally-compliant eviction notices.<br/>
            <span className="text-primary italic">Zero stress.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
            Stop worrying about technicalities and paperwork rejection. Generate perfect, localized rent increase and eviction notices in seconds with our professional desktop software.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mt-4 w-full sm:w-auto">
            <Link href="/pricing" className="bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-medium hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl hover:-translate-y-0.5 duration-200 text-center">
              View pricing
            </Link>
            <Link href="/download" className="border border-primary/30 text-primary px-8 py-4 rounded-md text-lg font-medium hover:bg-primary/5 transition-colors text-center">
              Download the software
            </Link>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="text-buildium-mention">
            Now with Buildium integration — import your properties, tenants, and
            outstanding balances in one click, then generate notices instantly.
          </p>
        </section>
      </main>
    </div>
  );
}
