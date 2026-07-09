import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const navLinks = [
  { href: "/download", label: "Download" },
  { href: "/pricing", label: "Pricing" },
  { href: "/login", label: "Log in" },
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  return (
    <header className="flex items-center justify-between py-4 md:py-6 px-4 sm:px-8 max-w-7xl mx-auto w-full">
      <Link href="/" className="text-xl md:text-2xl font-serif font-bold text-primary tracking-tight">
        RentNotice Pro
      </Link>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              location === link.href
                ? "text-foreground font-semibold"
                : "text-foreground/80 hover:text-foreground transition-colors"
            }
          >
            {link.label}
          </Link>
        ))}
        <Link
          href="/signup"
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors shadow-sm"
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
            className="md:hidden"
            aria-label="Open menu"
            data-testid="button-mobile-menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-72">
          <SheetHeader className="text-left">
            <SheetTitle className="font-serif text-primary">RentNotice Pro</SheetTitle>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`px-3 py-2.5 rounded-md text-base font-medium transition-colors ${
                  location === link.href
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`link-mobile-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className="mt-3 bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-center font-medium hover:bg-primary/90 transition-colors shadow-sm"
              data-testid="link-mobile-get-started"
            >
              Get Started
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
