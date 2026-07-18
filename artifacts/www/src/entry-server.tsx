import React from "react";
import { renderToString } from "react-dom/server";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "./components/ui/tooltip";
import { ROUTE_SEO } from "../seo.config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

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

export function render(url: string): string {
  const hook = makeStaticHook(url);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        enabled: false,
      },
    },
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
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
      const body = render(routePath);
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
