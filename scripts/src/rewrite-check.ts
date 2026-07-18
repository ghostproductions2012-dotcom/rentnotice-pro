/**
 * Production rewrite drift check for the marketing site (artifacts/www).
 *
 * Every indexable route in ROUTE_SEO that is not "/" must have an explicit
 * [[services.production.rewrites]] entry in artifact.toml pointing to its
 * prerendered index.html.  Without an explicit rewrite the catch-all
 * `/* -> /index.html` can serve the home-page shell instead of the
 * prerendered page, breaking bot crawlability for those routes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const wwwDir = path.resolve(root, "artifacts", "www");

// ---------------------------------------------------------------------------
// 1. Collect indexable routes from ROUTE_SEO
// ---------------------------------------------------------------------------
const seoConfigPath = path.join(wwwDir, "seo.config.ts");
const seo = (await import(seoConfigPath)) as {
  ROUTE_SEO: Record<string, { noindex?: boolean }>;
};

const indexableRoutes = Object.entries(seo.ROUTE_SEO)
  .filter(([route, cfg]) => route !== "/" && !cfg.noindex)
  .map(([route]) => route);

// ---------------------------------------------------------------------------
// 2. Parse rewrites from artifact.toml (without a TOML parser dependency)
//    Each rewrite block looks like:
//      [[services.production.rewrites]]
//      from = "/pricing"
//      to = "/pricing/index.html"
// ---------------------------------------------------------------------------
const tomlPath = path.join(wwwDir, ".replit-artifact", "artifact.toml");
const toml = fs.readFileSync(tomlPath, "utf8");

const rewriteFroms = new Set<string>();
for (const m of toml.matchAll(/from\s*=\s*"([^"]+)"/g)) {
  const from = m[1];
  if (from !== "/*") rewriteFroms.add(from);
}

// ---------------------------------------------------------------------------
// 3. Report any indexable route without an explicit rewrite
// ---------------------------------------------------------------------------
const failures: string[] = [];

for (const route of indexableRoutes) {
  if (!rewriteFroms.has(route)) {
    failures.push(
      `Route "${route}" is indexable (in ROUTE_SEO) but has no explicit production rewrite in artifact.toml. ` +
        `Add: [[services.production.rewrites]] from = "${route}" to = "${route}/index.html"`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Production rewrite drift check FAILED (${failures.length} issue(s)):`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Production rewrite check passed: all ${indexableRoutes.length} indexable routes have explicit rewrites in artifact.toml.`,
);
