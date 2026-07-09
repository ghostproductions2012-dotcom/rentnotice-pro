import { Link } from "wouter";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="flex items-center justify-between py-6 px-8 max-w-7xl mx-auto w-full">
        <div className="text-2xl font-serif font-bold text-primary tracking-tight">RentNotice Pro</div>
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link href="/download" className="text-foreground/80 hover:text-foreground transition-colors">Download</Link>
          <Link href="/pricing" className="text-foreground/80 hover:text-foreground transition-colors">Pricing</Link>
          <Link href="/login" className="text-foreground/80 hover:text-foreground transition-colors">Log in</Link>
          <Link href="/signup" className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors shadow-sm">Get Started</Link>
        </nav>
      </header>

      <main className="flex-1 flex flex-col">
        <section className="py-24 px-8 max-w-5xl mx-auto text-center flex flex-col items-center gap-8">
          <div className="inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-primary/20 bg-primary/5 text-primary">
            Trusted by top property managers
          </div>
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.1]">
            Legally-compliant eviction notices.<br/>
            <span className="text-primary italic">Zero stress.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
            Stop worrying about technicalities and paperwork rejection. Generate perfect, localized rent increase and eviction notices in seconds with our professional desktop software.
          </p>
          <div className="flex items-center gap-4 mt-4">
            <Link href="/pricing" className="bg-primary text-primary-foreground px-8 py-4 rounded-md text-lg font-medium hover:bg-primary/90 transition-colors shadow-lg hover:shadow-xl hover:-translate-y-0.5 duration-200">
              View pricing
            </Link>
            <Link href="/download" className="border border-primary/30 text-primary px-8 py-4 rounded-md text-lg font-medium hover:bg-primary/5 transition-colors">
              Download the software
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
