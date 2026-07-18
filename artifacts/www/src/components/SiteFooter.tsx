import { Link } from "wouter";

export default function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-background pt-16 pb-8 px-4 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-xs">
                R
              </div>
              <span className="text-xl font-serif font-bold text-foreground tracking-tight">
                RentNotice Pro
              </span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Professional eviction notice preparation software for property management companies in all 50 states and DC. Defensible, compliant, and precise.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-foreground mb-4">Product</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link href="/features" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="/how-it-works" className="hover:text-primary transition-colors">How it Works</Link></li>
              <li><Link href="/integrations" className="hover:text-primary transition-colors">Integrations</Link></li>
              <li><Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
              <li><Link href="/download" className="hover:text-primary transition-colors">Download</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Resources</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link href="/faq" className="hover:text-primary transition-colors">FAQ</Link></li>
              <li><Link href="/support" className="hover:text-primary transition-colors">Support</Link></li>
              <li><Link href="/coverage" className="hover:text-primary transition-colors">State Notice Laws</Link></li>
              <li><Link href="/guidelines" className="hover:text-primary transition-colors">Eviction Guidelines</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Company</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link href="/login" className="hover:text-primary transition-colors">Log in</Link></li>
              <li><Link href="/signup" className="hover:text-primary transition-colors">Sign up</Link></li>
              <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} RentNotice Pro. All rights reserved.</p>
          <p>
            RentNotice Pro prepares pay-or-quit notices for all 50 states and DC. Non-California templates are generic starting points; attorney review is recommended. It does not provide legal advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
