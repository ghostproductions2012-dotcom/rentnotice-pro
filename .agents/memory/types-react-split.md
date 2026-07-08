---
name: "@types/react version split"
description: Why web artifacts' typechecks break after the Expo mobile artifact exists, and the two-part fix pattern.
---

The Expo mobile artifact pins an older `@types/react` (19.1.x) while the web catalog uses 19.2.x, so two copies coexist and pnpm's hidden hoisted fallback (`node_modules/.pnpm/node_modules`) can be the older one.

**Why it breaks:**
1. Packages that import React types but declare no `@types/react` peer (e.g. lucide-react, react-day-picker) type-resolve via the hoisted fallback — the old copy — and their props become incompatible with the consumer's newer React types.
2. Source files that use the global `React` namespace without `import * as React from "react"` (some shadcn files like spinner.tsx, button-group.tsx) also bind to whichever copy provides the UMD global, which can be the old one.

**How to apply:**
- For case 1: add a `packageExtensions` entry in `pnpm-workspace.yaml` giving the offending package an `'@types/react': '*'` peer (existing entries for react-day-picker and lucide-react show the pattern), then `pnpm install`.
- For case 2: add `import * as React from "react"` to the file.
- Symptom signature: TS2322 errors saying `React.CSSProperties`/`Ref` from one `@types+react@x` path is not assignable to another version's path ("two different types with this name exist").
- To find which package pulls in the old copy: run `tsc -p <artifact>/tsconfig.json --noEmit --explainFiles` and grep for the older `@types+react` version — the "Imported via 'react' from ..." lines name the offending untyped-peer packages.
