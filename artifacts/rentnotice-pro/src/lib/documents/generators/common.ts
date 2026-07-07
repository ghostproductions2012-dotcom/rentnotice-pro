// ---------------------------------------------------------------------------
// Shared helpers for the individual document generators.
// ---------------------------------------------------------------------------

import { DocBuilder, bytesToBlob } from "../pdf-kit";
import {
  shouldWatermark,
  type DocumentContext,
  type GeneratedDocument,
  type GenerateOptions,
} from "../context";

/** Create a DocBuilder pre-configured with header/footer/watermark for a context. */
export async function newBuilder(
  ctx: DocumentContext,
  title: string,
  options?: GenerateOptions,
): Promise<DocBuilder> {
  return DocBuilder.create({
    title,
    companyName: ctx.companyProfile.name || "RentNotice Pro",
    companySubtitle: ctx.companyProfile.address || undefined,
    watermark: shouldWatermark(ctx, options) ? "DRAFT" : null,
    generatedAt: options?.generatedAt,
  });
}

/** Finalize a builder into the uniform GeneratedDocument return shape. */
export async function finalize(builder: DocBuilder, filename: string): Promise<GeneratedDocument> {
  const { bytes, pageCount } = await builder.finish();
  return {
    bytes,
    blob: bytesToBlob(bytes),
    filename,
    pageCount,
  };
}

/** Short, filesystem-safe id fragment for filenames. */
export function shortId(ctx: DocumentContext): string {
  return ctx.notice.id.slice(0, 8);
}

/** Prefix draft filenames so they are obvious on disk. */
export function fileName(ctx: DocumentContext, base: string, options?: GenerateOptions): string {
  const draft = shouldWatermark(ctx, options) ? "DRAFT_" : "";
  return `${draft}${base}_${shortId(ctx)}.pdf`;
}
