/**
 * Sitemap / SEO drift check for the marketing site (artifacts/www).
 *
 * 1. Every public marketing route declared in src/App.tsx must be covered by
 *    ROUTE_SEO or SITEMAP_EXTRA_ROUTES in seo.config.ts (so it lands in
 *    sitemap.xml). Auth/portal/admin/checkout routes are excluded.
 * 2. The generated sitemap.xml must contain exactly those routes.
 * 3. Every page produced by the build-time SEO transform must include a
 *    canonical link that matches its og:url. If a built dist exists, the
 *    actual built HTML files are verified too.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wwwDir = path.resolve(here, "..", "..", "artifacts", "www");

const seoConfigPath = path.join(wwwDir, "seo.config.ts");
const seo = (await import(seoConfigPath)) as {
  SITE_ORIGIN: string;
  ROUTE_SEO: Record<string, { title: string; description: string }>;
  SITEMAP_EXTRA_ROUTES: string[];
  buildSitemapXml: () => string;
  applySeoToHtml: (html: string, routePath: string) => string;
};

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

// ---------------------------------------------------------------------------
// 1. Route coverage: App.tsx routes vs ROUTE_SEO + SITEMAP_EXTRA_ROUTES
// ---------------------------------------------------------------------------
const appTsx = fs.readFileSync(path.join(wwwDir, "src", "App.tsx"), "utf8");
const routePaths = [...appTsx.matchAll(/<Route\s+path="([^"]+)"/g)].map(
  (m) => m[1],
);
if (routePaths.length === 0) {
  fail("Could not find any <Route path=\"...\"> entries in App.tsx");
}

const NON_PUBLIC_PREFIXES = [
  "/signup",
  "/login",
  "/checkout",
  "/portal",
  "/admin",
  "/www",
];

const publicRoutes = routePaths.filter((p) => {
  if (p.includes(":") || p.includes("*")) return false; // dynamic/catch-all
  return !NON_PUBLIC_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix + "/"),
  );
});

const covered = new Set([
  ...Object.keys(seo.ROUTE_SEO),
  ...seo.SITEMAP_EXTRA_ROUTES,
]);

for (const route of publicRoutes) {
  if (!covered.has(route)) {
    fail(
      `Public marketing route "${route}" in App.tsx is missing from ROUTE_SEO and SITEMAP_EXTRA_ROUTES in artifacts/www/seo.config.ts — it will never appear in sitemap.xml.`,
    );
  }
}

for (const route of covered) {
  if (!routePaths.includes(route)) {
    fail(
      `Route "${route}" is listed in seo.config.ts but has no matching <Route> in App.tsx — remove it or add the page.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Sitemap XML contains exactly the covered routes
// ---------------------------------------------------------------------------
const sitemap = seo.buildSitemapXml();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const route of covered) {
  const expected = `${seo.SITE_ORIGIN}${route === "/" ? "/" : route}`;
  if (!locs.includes(expected)) {
    fail(`sitemap.xml is missing <loc>${expected}</loc>`);
  }
}
if (locs.length !== covered.size) {
  fail(
    `sitemap.xml has ${locs.length} entries but ${covered.size} routes are configured.`,
  );
}

// ---------------------------------------------------------------------------
// 3. Canonical link matches og:url for every SEO-transformed page
// ---------------------------------------------------------------------------
function checkCanonical(html: string, label: string, expectedUrl?: string) {
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/)?.[1];
  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/)?.[1];
  if (!canonical) {
    fail(`${label}: no <link rel="canonical"> found.`);
    return;
  }
  if (!ogUrl) {
    fail(`${label}: no og:url meta tag found.`);
    return;
  }
  if (canonical !== ogUrl) {
    fail(`${label}: canonical "${canonical}" does not match og:url "${ogUrl}".`);
  }
  if (expectedUrl && canonical !== expectedUrl) {
    fail(`${label}: canonical "${canonical}" expected "${expectedUrl}".`);
  }
}

const templateHtml = fs.readFileSync(path.join(wwwDir, "index.html"), "utf8");
for (const route of Object.keys(seo.ROUTE_SEO)) {
  const expectedUrl = `${seo.SITE_ORIGIN}${route === "/" ? "" : route}`;
  const transformed = seo.applySeoToHtml(templateHtml, route);
  checkCanonical(transformed, `SEO transform for ${route}`, expectedUrl);
}

// If a production build exists, verify the actual emitted HTML files too.
const distDir = path.join(wwwDir, "dist", "public");
if (fs.existsSync(path.join(distDir, "index.html"))) {
  for (const route of Object.keys(seo.ROUTE_SEO)) {
    const file =
      route === "/"
        ? path.join(distDir, "index.html")
        : path.join(distDir, route.slice(1), "index.html");
    if (!fs.existsSync(file)) {
      fail(`Built page missing for ${route}: expected ${file}`);
      continue;
    }
    const expectedUrl = `${seo.SITE_ORIGIN}${route === "/" ? "" : route}`;
    checkCanonical(
      fs.readFileSync(file, "utf8"),
      `Built page ${route}`,
      expectedUrl,
    );
  }
  const builtSitemap = path.join(distDir, "sitemap.xml");
  if (!fs.existsSync(builtSitemap)) {
    fail("Built dist is missing sitemap.xml");
  }
}

// ---------------------------------------------------------------------------
// 4. Client-side <Seo> must source title/description from ROUTE_SEO
//    (one source of truth). A hardcoded string on a ROUTE_SEO page can drift
//    from the prerendered build-time values and produce inconsistent Google
//    snippets.
// ---------------------------------------------------------------------------
function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const srcDir = path.join(wwwDir, "src");
const seoUsages: {
  file: string;
  route: string;
  attrs: string;
}[] = [];
for (const file of walkTsx(srcDir)) {
  const content = fs.readFileSync(file, "utf8");
  for (const m of content.matchAll(/<Seo\b([\s\S]*?)\/>/g)) {
    const attrs = m[1];
    const pathAttr = attrs.match(/path=(?:"([^"]*)"|\{([^}]*)\})/);
    if (!pathAttr) continue; // dynamic path (e.g. ProsePage) handled below
    const staticPath = pathAttr[1];
    if (staticPath === undefined) continue;
    const route = staticPath === "" ? "/" : staticPath;
    seoUsages.push({ file: path.relative(wwwDir, file), route, attrs });
  }
}

for (const route of Object.keys(seo.ROUTE_SEO)) {
  const usages = seoUsages.filter((u) => u.route === route);
  if (usages.length === 0) {
    // ProsePage-style pages pass path dynamically and read ROUTE_SEO directly;
    // only flag if no component references ROUTE_SEO for this route at all.
    const referenced = walkTsx(srcDir).some((file) =>
      fs.readFileSync(file, "utf8").includes(`ROUTE_SEO["${route}"]`),
    );
    if (!referenced) {
      fail(
        `No <Seo> usage found for ROUTE_SEO route "${route}" — the page should render <Seo> with ROUTE_SEO["${route}"] values.`,
      );
    }
    continue;
  }
  for (const usage of usages) {
    const expectTitle = `ROUTE_SEO["${route}"].title`;
    const expectDesc = `ROUTE_SEO["${route}"].description`;
    if (!usage.attrs.includes(expectTitle)) {
      fail(
        `${usage.file}: <Seo> for "${route}" must use title={${expectTitle}} (found a hardcoded or mismatched title). Client-side SEO must come from seo.config.ts so it can't drift from the prerendered values.`,
      );
    }
    if (!usage.attrs.includes(expectDesc)) {
      fail(
        `${usage.file}: <Seo> for "${route}" must use description={${expectDesc}} (found a hardcoded or mismatched description).`,
      );
    }
  }
}

// Any <Seo> with a hardcoded title on a route that IS in ROUTE_SEO is caught
// above. Also verify that non-ROUTE_SEO static Seo routes (e.g. /pricing,
// /download) don't accidentally reuse a ROUTE_SEO route path.
for (const usage of seoUsages) {
  if (!(usage.route in seo.ROUTE_SEO) && !covered.has(usage.route)) {
    fail(
      `${usage.file}: <Seo> uses path "${usage.route}" which is not in ROUTE_SEO or SITEMAP_EXTRA_ROUTES — add it to seo.config.ts.`,
    );
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`Sitemap/SEO drift check FAILED (${failures.length} issue(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `Sitemap/SEO drift check passed: ${publicRoutes.length} public routes covered, ${covered.size} sitemap entries, canonical == og:url on all ${Object.keys(seo.ROUTE_SEO).length} SEO pages.`,
);
