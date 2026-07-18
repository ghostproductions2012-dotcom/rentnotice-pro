import { STATE_COVERAGE } from "./src/lib/coverage-data";

export interface RouteSeo {
  title: string;
  description: string;
  noindex?: boolean;
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
    title: "Eviction Notice Software Features — RentNotice Pro",
    description:
      "Explore RentNotice Pro features: automated pay-or-quit notice generation for all 50 states and DC, fee calculators, deadline tracking, offline mobile field service, and court-ready evidence packets.",
  },
  "/how-it-works": {
    title: "How Pay-or-Quit Notice Software Works — RentNotice Pro",
    description:
      "See how RentNotice Pro works: import your rent ledger, generate pay-or-quit notices for any of the 50 states and DC, serve them in the field with photo evidence, and track every deadline automatically.",
  },
  "/integrations": {
    title: "Eviction Notice Software Integrations — RentNotice Pro",
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
  "/pricing": {
    title: "Pricing — RentNotice Pro",
    description:
      "Simple, transparent pricing for RentNotice Pro. Choose the plan that fits your property portfolio.",
  },
  "/download": {
    title: "Download — RentNotice Pro",
    description:
      "Download RentNotice Pro for Windows and macOS. Get the desktop app for automated rent notices, deadline tracking, and court-ready evidence.",
  },
  "/login": {
    title: "Log In — RentNotice Pro",
    description: "Log in to your RentNotice Pro account to manage notices, licensing, and billing.",
    noindex: true,
  },
  "/signup": {
    title: "Create Account — RentNotice Pro",
    description: "Start your RentNotice Pro subscription to generate pay-or-quit notices for all 50 states and DC.",
    noindex: true,
  },
};

export const SITEMAP_EXTRA_ROUTES: string[] = [];

export function buildSitemapXml(): string {
  const routes = [...Object.keys(ROUTE_SEO), ...SITEMAP_EXTRA_ROUTES];
  const entries = routes
    .filter((routePath) => !ROUTE_SEO[routePath]?.noindex)
    .map((routePath) => {
      const loc = `${SITE_ORIGIN}${routePath === "/" ? "/" : routePath}`;
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

const FAQ_ITEMS = [
  {
    question: "Is RentNotice Pro considered legal advice?",
    answer:
      "No. RentNotice Pro is a software tool that calculates and formats pay-or-quit notices for all 50 states and DC. California templates are attorney-reviewed; templates for other states are generic starting points that are not attorney-reviewed. The software automates math and formatting, but does not substitute for the counsel of an attorney. We always recommend having your attorney review final notices before service.",
  },
  {
    question: "Where is my tenant data stored?",
    answer:
      "RentNotice Pro is built with a local-first architecture. The desktop application stores your sensitive tenant data, property information, and ledgers locally on your machine. We do not aggregate or sell your proprietary management data.",
  },
  {
    question: "How does team licensing work?",
    answer:
      "We offer seat-based team licensing. Administrators can purchase seats and send email invitations from the portal. Roles can be assigned (Admin vs. User) to restrict who can finalize documents or manage billing.",
  },
  {
    question: "What platforms does the software support?",
    answer:
      "The desktop application is available for Mac, Windows, and Linux. The companion field application for process servers is available on mobile devices via web and progressive web app functionality.",
  },
  {
    question: "How does the built-in court calendar work?",
    answer:
      "Many states prohibit eviction notices from expiring on weekends or judicial holidays. Our engine applies state-specific notice periods and court holiday calendars — with the deepest coverage for California, including a rigorously maintained calendar of California state court holidays. When you select a date of service, it automatically skips invalid days to determine the correct expiration date.",
  },
  {
    question: "Can I cancel my subscription at any time?",
    answer:
      "Yes. You can manage your billing, update payment methods, or cancel your subscription at any time through our self-serve Stripe billing portal.",
  },
];

function buildJsonLd(routePath: string): string | null {
  if (routePath === "/") {
    const schema = [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "RentNotice Pro",
        url: SITE_ORIGIN,
        description:
          "Eviction notice preparation software for property managers in all 50 states and DC. Attorney-reviewed California templates, plus built-in starting points for every other state.",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "support@rentnoticepro.com",
          url: `${SITE_ORIGIN}/support`,
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "RentNotice Pro",
        url: SITE_ORIGIN,
      },
    ];
    return JSON.stringify(schema);
  }

  if (routePath === "/faq") {
    const schema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    };
    return JSON.stringify(schema);
  }

  if (routePath === "/coverage") {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Pay-or-Quit Notice Periods — All 50 States + DC",
      description:
        "Statutory pay-or-quit notice periods and citations for all 50 U.S. states and the District of Columbia, as supported by RentNotice Pro eviction notice software.",
      url: `${SITE_ORIGIN}/coverage`,
      publisher: {
        "@type": "Organization",
        name: "RentNotice Pro",
        url: SITE_ORIGIN,
      },
      license: `${SITE_ORIGIN}/terms`,
      distribution: {
        "@type": "DataDownload",
        encodingFormat: "text/html",
        contentUrl: `${SITE_ORIGIN}/coverage`,
      },
      variableMeasured: [
        "State name",
        "Pay-or-quit notice period (days)",
        "Statutory citation",
        "Attorney-reviewed status",
      ],
      hasPart: STATE_COVERAGE.map((s) => ({
        "@type": "StatisticalVariable",
        name: `${s.name} Pay-or-Quit Notice Period`,
        description: `${s.periodLabel}. ${s.citation}${s.attorneyReviewed ? " Attorney-reviewed template available." : ""}`,
        measurementTechnique: "Statutory research",
        statType: "pay-or-quit notice period",
      })),
    };
    return JSON.stringify(schema);
  }

  if (routePath === "/download") {
    const schema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "RentNotice Pro",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Windows 10, Windows 11, macOS 10.15 Catalina or later",
      description:
        "Pay-or-quit notice preparation software for property managers. Covers all 50 states and DC with attorney-reviewed California templates, automated deadline calculation, and court-ready evidence packets.",
      url: `${SITE_ORIGIN}/download`,
      offers: {
        "@type": "Offer",
        url: `${SITE_ORIGIN}/pricing`,
      },
      publisher: {
        "@type": "Organization",
        name: "RentNotice Pro",
        url: SITE_ORIGIN,
      },
    };
    return JSON.stringify(schema);
  }

  return null;
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

  setMeta("name", "robots", seo.noindex ? "noindex, nofollow" : "index, follow");
  setMeta("name", "description", description);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", url);
  setMeta("property", "og:site_name", "RentNotice Pro");
  setMeta("property", "og:locale", "en_US");
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

  const jsonLd = buildJsonLd(routePath);
  if (jsonLd) {
    out = out.replace(
      /<\/head>/,
      `  <script type="application/ld+json">${jsonLd}</script>\n  </head>`,
    );
  }

  return out;
}
