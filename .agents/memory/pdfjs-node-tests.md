---
name: pdfjs in Node test runners
description: How to run pdfjs-dist PDF parsing inside Node-based vitest (legacy build alias, worker path, DOM stubs)
---

# Running pdfjs-dist in Node tests

The modern `pdfjs-dist` build (v5+) assumes browser-only JS features (e.g. `Uint8Array.prototype.toHex`, ES2026) that Node lacks — in Node it fails with cryptic errors like `UnknownErrorException: a.toHex is not a function`.

**How to apply:** in the vitest config, alias the *bare* specifier only (regex `/^pdfjs-dist$/`) to `pdfjs-dist/legacy/build/pdf.mjs` so `?url` worker imports stay untouched. In the test, stub `DOMMatrix`/`Path2D`/`ImageData` globals and set `GlobalWorkerOptions.workerSrc` to the **legacy** worker file via `pathToFileURL(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href`.

**Why:** this lets full-pipeline tests parse real PDF fixtures (e.g. the First Light sample statement) headlessly, which caught real extraction bugs that hand-written line fixtures missed (the PDF's property label line carried a listing-index suffix like "2021 Carnegie Lane #5 - 1" that guessing the layout didn't reveal). Prefer parsing the real asset over guessed fixtures when a sample file exists.
