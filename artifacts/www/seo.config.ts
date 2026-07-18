export interface RouteSeo {
  title: string;
  description: string;
}

export const SITE_ORIGIN = "https://rentnoticepro.com";

export const ROUTE_SEO: Record<string, RouteSeo> = {
  "/": {
    title:
      "RentNotice Pro — Pay-or-Quit Notice Software for All 50 States + DC",
    description:
      "Eviction notice preparation software for property managers in all 50 states and DC. Attorney-reviewed California templates, plus built-in starting points for every other state.",
  },
  "/features": {
    title: "Features — RentNotice Pro",
    description:
      "Explore RentNotice Pro features: automated pay-or-quit notice generation for all 50 states and DC, fee calculators, deadline tracking, offline mobile field service, and court-ready evidence packets.",
  },
  "/how-it-works": {
    title: "How It Works — RentNotice Pro",
    description:
      "See how RentNotice Pro works: import your rent ledger, generate pay-or-quit notices for any of the 50 states and DC, serve them in the field with photo evidence, and track every deadline automatically.",
  },
  "/integrations": {
    title: "Integrations — RentNotice Pro",
    description:
      "RentNotice Pro connects with your property management stack — ledger imports, mobile field sync, billing, and team management — to streamline your pay-or-quit notice workflow.",
  },
  "/coverage": {
    title: "State Notice Laws — RentNotice Pro Coverage",
    description:
      "See exactly what RentNotice Pro covers in your state: pay-or-quit notice periods and statutory citations for all 50 states and DC, with attorney-reviewed California templates.",
  },
  "/faq": {
    title: "FAQ — RentNotice Pro",
    description:
      "Answers to common questions about RentNotice Pro: pricing, licensing, state coverage across all 50 states and DC, offline use, mobile field service, and getting started.",
  },
  "/guidelines": {
    title: "Eviction Guidelines — RentNotice Pro",
    description:
      "A practical overview of the nonpayment eviction process for property managers: verifying the ledger, choosing the right notice, calculating deadlines, serving correctly, and filing in court.",
  },
  "/support": {
    title: "Support — RentNotice Pro",
    description:
      "Get help with RentNotice Pro: email support, FAQ, customer portal for licensing and billing, and desktop and mobile app downloads.",
  },
  "/privacy": {
    title: "Privacy Policy — RentNotice Pro",
    description:
      "How RentNotice Pro handles your data: local-first storage keeps tenant records on your machines, with limited account, billing, and sync data processed to run the service.",
  },
  "/terms": {
    title: "Terms of Service — RentNotice Pro",
    description:
      "The terms that govern use of RentNotice Pro, including licensing, billing, acceptable use, and the scope of the software as document preparation — not legal advice.",
  },
};

export const SITEMAP_EXTRA_ROUTES = ["/pricing", "/download"];

export function buildSitemapXml(): string {
  const routes = [...Object.keys(ROUTE_SEO), ...SITEMAP_EXTRA_ROUTES];
  const entries = routes
    .map((routePath) => {
      const loc = `${SITE_ORIGIN}${routePath === "/" ? "/" : routePath}`;
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applySeoToHtml(html: string, routePath: string): string {
  const seo = ROUTE_SEO[routePath];
  if (!seo) return html;

  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const url = `${SITE_ORIGIN}${routePath === "/" ? "" : routePath}`;

  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);

  const setMeta = (attr: "name" | "property", key: string, content: string) => {
    const re = new RegExp(
      `(<meta\\s+${attr}="${key.replace(/[:]/g, "\\$&")}"\\s+content=")[^"]*(")`,
    );
    if (re.test(out)) {
      out = out.replace(re, `$1${content}$2`);
    } else {
      out = out.replace(
        /<\/head>/,
        `  <meta ${attr}="${key}" content="${content}" />\n  </head>`,
      );
    }
  };

  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", url);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("property", "og:image", `${SITE_ORIGIN}/opengraph.jpg`);
  setMeta("name", "twitter:image", `${SITE_ORIGIN}/opengraph.jpg`);

  const canonicalRe = /(<link\s+rel="canonical"\s+href=")[^"]*(")/;
  if (canonicalRe.test(out)) {
    out = out.replace(canonicalRe, `$1${url}$2`);
  } else {
    out = out.replace(
      /<\/head>/,
      `  <link rel="canonical" href="${url}" />\n  </head>`,
    );
  }

  return out;
}
