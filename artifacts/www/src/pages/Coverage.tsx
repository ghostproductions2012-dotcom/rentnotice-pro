import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Search, ShieldCheck, FileText } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Seo from "@/components/Seo";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { STATE_COVERAGE } from "@/lib/coverage-data";
import { ROUTE_SEO } from "../../seo.config";

export default function Coverage() {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? STATE_COVERAGE.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q,
      )
    : STATE_COVERAGE;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo
        title={ROUTE_SEO["/coverage"].title}
        description={ROUTE_SEO["/coverage"].description}
        path="/coverage"
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
              What's covered in <br />
              <span className="text-gradient italic">your state.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground"
            >
              Pay-or-quit notice periods and statutory citations for all 50
              states and the District of Columbia — so you know exactly what
              you're getting before you sign up.
            </motion.p>
          </div>
        </section>

        {/* Legend */}
        <section className="pt-16 px-4 sm:px-8">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 flex gap-4">
              <ShieldCheck className="h-6 w-6 text-primary shrink-0 mt-1" />
              <div>
                <h2 className="font-semibold text-foreground mb-1">
                  Attorney-reviewed: California
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  California statutory templates are attorney-reviewed and
                  paired with a maintained calendar of California state court
                  holidays for court-day deadline math.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 flex gap-4">
              <FileText className="h-6 w-6 text-muted-foreground shrink-0 mt-1" />
              <div>
                <h2 className="font-semibold text-foreground mb-1">
                  Generic starting points: all other states + DC
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Templates for other jurisdictions are deliberately generic
                  starting points that are not attorney-reviewed. We recommend
                  having your attorney review final notices before service.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="py-16 px-4 sm:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="relative mb-8 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find your state…"
                className="pl-9 bg-white/[0.02] border-white/10"
                data-testid="input-coverage-search"
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03] text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">State</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">
                      Pay-or-quit period
                    </th>
                    <th className="px-4 py-3 font-medium">Statutory citation</th>
                    <th className="px-4 py-3 font-medium">Template status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.code}
                      className={`border-b border-white/5 last:border-b-0 ${
                        s.attorneyReviewed ? "bg-primary/5" : ""
                      }`}
                      data-testid={`row-coverage-${s.code}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {s.name}
                      </td>
                      <td className="px-4 py-3 text-foreground/80 whitespace-nowrap">
                        {s.periodLabel}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{s.citation}</div>
                        <div className="text-xs text-muted-foreground/70 mt-0.5">
                          {s.terminationNote}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {s.attorneyReviewed ? (
                          <Badge className="bg-primary/15 text-primary border border-primary/30 hover:bg-primary/15">
                            Attorney-reviewed
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground border-white/15"
                          >
                            Generic starting point
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No state matches "{query}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
              Notice periods and citations are provided as a summary of the
              statutory reference data built into RentNotice Pro and may change
              as laws are amended. "Set by state law" indicates no fixed
              statutory cure period for nonpayment. This page is not legal
              advice; consult your attorney for guidance on your specific
              situation.
            </p>

            <div className="mt-12 text-center">
              <Link
                href="/signup"
                className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-md hover:bg-primary/90 transition-colors font-semibold shadow-[0_0_20px_rgba(237,187,82,0.15)]"
                data-testid="link-coverage-get-started"
              >
                Get Started
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
