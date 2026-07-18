import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Seo from "@/components/Seo";
import { ROUTE_SEO } from "../../seo.config";

interface ProsePageProps {
  path: string;
  heading: string;
  subheading?: string;
  children: React.ReactNode;
}

export default function ProsePage({ path, heading, subheading, children }: ProsePageProps) {
  const seo = ROUTE_SEO[path];
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30">
      <Seo title={seo.title} description={seo.description} path={path} />
      <SiteHeader />
      <main className="flex-1">
        <section className="pt-24 pb-12 px-4 sm:px-8 border-b border-white/5">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-serif text-foreground leading-[1.1] tracking-tight mb-4">
              {heading}
            </h1>
            {subheading && (
              <p className="text-muted-foreground text-lg">{subheading}</p>
            )}
          </div>
        </section>
        <section className="py-12 px-4 sm:px-8">
          <div className="max-w-3xl mx-auto space-y-10">{children}</div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export function ProseSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
