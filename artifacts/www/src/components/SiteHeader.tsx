import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it Works" },
  { href: "/integrations", label: "Integrations" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/download", label: "Download" },
  { href: "/login", label: "Log in" },
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center justify-between py-4 md:py-5 px-4 sm:px-8 max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-lg">
            R
          </div>
          <span className="text-xl md:text-2xl font-serif font-bold text-foreground tracking-tight">
            RentNotice Pro
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                location === link.href
                  ? "text-primary font-semibold transition-colors"
                  : "text-foreground/70 hover:text-foreground transition-colors"
              }
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors shadow-[0_0_20px_rgba(237,187,82,0.15)] font-semibold"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile nav */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-foreground"
              aria-label="Open menu"
              data-testid="button-mobile-menu"
            >
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 bg-background border-l-white/10">
            <SheetHeader className="text-left">
              <SheetTitle className="font-serif text-foreground flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-sm">
                  R
                </div>
                RentNotice Pro
              </SheetTitle>
            </SheetHeader>
            <nav className="mt-8 flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`px-4 py-3 rounded-md text-base font-medium transition-all ${
                    location === link.href
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-white/5 hover:text-foreground"
                  }`}
                  data-testid={`link-mobile-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {link.label}
                </Link>
              ))}
              <div className="h-px bg-white/10 my-2" />
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="mt-2 bg-primary text-primary-foreground px-4 py-3 rounded-md text-center font-bold hover:bg-primary/90 transition-colors shadow-sm"
                data-testid="link-mobile-get-started"
              >
                Get Started
              </Link>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
