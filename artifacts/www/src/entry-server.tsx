import React from "react";
import { renderToString } from "react-dom/server";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { ROUTE_SEO } from "../seo.config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import downloadSnapshotJson from "./ssr-download-snapshot.json" assert { type: "json" };

import Home from "./pages/Home";
import Features from "./pages/Features";
import HowItWorks from "./pages/HowItWorks";
import Integrations from "./pages/Integrations";
import FAQ from "./pages/FAQ";
import Coverage from "./pages/Coverage";
import Download from "./pages/Download";
import Pricing from "./pages/Pricing";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Guidelines from "./pages/Guidelines";
import Support from "./pages/Support";

function makeStaticHook(path: string) {
  const hook = () => [path, () => {}] as [string, (path: string) => void];
  (hook as unknown as { searchHook: () => string }).searchHook = () => "";
  return hook;
}

export function render(url: string, queryClient?: QueryClient): string {
  const hook = makeStaticHook(url);
  const client = queryClient ?? new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        enabled: false,
      },
    },
  });
  return renderToString(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WouterRouter hook={hook} base="">
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/features" component={Features} />
            <Route path="/how-it-works" component={HowItWorks} />
            <Route path="/integrations" component={Integrations} />
            <Route path="/faq" component={FAQ} />
            <Route path="/coverage" component={Coverage} />
            <Route path="/download" component={Download} />
            <Route path="/pricing" component={Pricing} />
            <Route path="/terms" component={Terms} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/guidelines" component={Guidelines} />
            <Route path="/support" component={Support} />
          </Switch>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const PLANS_QUERY_KEY = ["/api/www/plans"] as const;
const DOWNLOADS_QUERY_KEY = ["/api/www/downloads/latest"] as const;

const STATIC_PLANS = [
  {
    tier: "starter",
    name: "Starter",
    description: "For independent landlords managing a handful of units.",
    seats: 3,
    priceMonthlyCents: 4900,
    features: [
      "Up to 3 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Email support",
    ],
    stripePriceId: null,
    available: true,
    highlighted: false,
  },
  {
    tier: "professional",
    name: "Professional",
    description: "For growing property management teams.",
    seats: 10,
    priceMonthlyCents: 9900,
    features: [
      "Up to 10 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Priority support",
    ],
    stripePriceId: null,
    available: true,
    highlighted: true,
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    description: "For large portfolios and multi-office operations.",
    seats: 50,
    priceMonthlyCents: 24900,
    features: [
      "Up to 50 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Dedicated onboarding",
      "Priority support",
    ],
    stripePriceId: null,
    available: true,
    highlighted: false,
  },
  {
    tier: "unlimited",
    name: "Unlimited",
    description: "For large customers who never want to think about seats.",
    seats: null,
    priceMonthlyCents: 74999,
    features: [
      "Unlimited team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Dedicated onboarding",
      "Priority support",
    ],
    stripePriceId: null,
    available: true,
    highlighted: false,
  },
];

function makePricingQueryClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  qc.setQueryData(PLANS_QUERY_KEY, STATIC_PLANS);
  return qc;
}

/**
 * Committed download snapshot — guarantees real, non-null installer links in
 * the prerendered HTML even when the live API is unreachable at build time.
 *
 * Update this file after each desktop release by running:
 *   node -e "fetch('http://localhost:8080/api/www/downloads/latest').then(r=>r.json()).then(d=>require('fs').writeFileSync('src/ssr-download-snapshot.json',JSON.stringify(d,null,2)+'\n'))"
 * from artifacts/www/ while the API server is running.
 *
 * The live API fetch below overrides this snapshot with fresher data when
 * PRERENDER_API_BASE_URL or REPLIT_DEV_DOMAIN is set at build time.
 */
const DOWNLOAD_SNAPSHOT_FALLBACK = downloadSnapshotJson;

async function fetchDownloadInfo(apiBase: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apiBase}/api/www/downloads/latest`, {
      signal: controller.signal,
    });
    if (res.ok) return res.json();
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function makeDownloadQueryClient(): Promise<QueryClient> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });

  // Seed with the static fallback first — guarantees deterministic output
  // even when no API is reachable at build time.
  qc.setQueryData(DOWNLOADS_QUERY_KEY, DOWNLOAD_SNAPSHOT_FALLBACK);

  // Override with live data when an API base URL is configured.
  const apiBase =
    process.env.PRERENDER_API_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : null);

  if (apiBase) {
    const info = await fetchDownloadInfo(apiBase);
    if (info) {
      qc.setQueryData(DOWNLOADS_QUERY_KEY, info);
      console.log("[prerender] /download: seeded with live download info");
    } else {
      console.warn(
        "[prerender] /download: live fetch failed, using static fallback (set PRERENDER_API_BASE_URL for live links)",
      );
    }
  } else {
    console.warn(
      "[prerender] /download: no API base URL configured (PRERENDER_API_BASE_URL / REPLIT_DEV_DOMAIN), using static fallback",
    );
  }

  return qc;
}

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  import.meta.url === new URL(process.argv[1], "file:").href;

if (isMainModule) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const distPublic = join(__dirname, "..", "public");

  const publicRoutes = Object.keys(ROUTE_SEO);
  let rendered = 0;
  let skipped = 0;

  const pricingQueryClient = makePricingQueryClient();
  const downloadQueryClient = await makeDownloadQueryClient();

  for (const routePath of publicRoutes) {
    const htmlFile =
      routePath === "/"
        ? join(distPublic, "index.html")
        : join(distPublic, routePath.slice(1), "index.html");

    if (!fs.existsSync(htmlFile)) {
      console.warn(
        `[prerender] skipping ${routePath}: no HTML file at ${htmlFile}`,
      );
      skipped++;
      continue;
    }

    let html = fs.readFileSync(htmlFile, "utf8");

    try {
      let qc: QueryClient | undefined;
      if (routePath === "/pricing") qc = pricingQueryClient;
      else if (routePath === "/download") qc = downloadQueryClient;

      const body = render(routePath, qc);
      html = html.replace(
        '<div id="root"></div>',
        `<div id="root">${body}</div>`,
      );
      fs.writeFileSync(htmlFile, html);
      rendered++;
      console.log(`[prerender] ✓ ${routePath}`);
    } catch (err) {
      console.error(`[prerender] ✗ ${routePath}:`, err);
      skipped++;
    }
  }

  console.log(`[prerender] done — ${rendered} rendered, ${skipped} skipped`);
}
