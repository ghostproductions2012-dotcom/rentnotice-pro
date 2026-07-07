// ---------------------------------------------------------------------------
// pdf-kit — a small, offline, pdf-lib based layout engine used by every
// generator. Provides a professional legal-document layout: US Letter pages,
// embedded StandardFonts, consistent header/footer (generated timestamp +
// disclaimer), an optional DRAFT diagonal watermark, automatic word-wrapping,
// page breaks, and simple tables / key-value / checklist / signature helpers.
// ---------------------------------------------------------------------------

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { LEGAL_DISCLAIMER } from "../types";

// --------------------------------- geometry --------------------------------

export const PAGE_W = 612; // US Letter width (8.5in * 72)
export const PAGE_H = 792; // US Letter height (11in * 72)
export const MARGIN = 54; // 0.75in
export const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_LINE_Y = PAGE_H - 84;
const CONTENT_TOP = PAGE_H - 104;
const FOOTER_LINE_Y = 92;
const CONTENT_BOTTOM = 104;

// --------------------------------- palette ---------------------------------

export const COLORS = {
  ink: rgb(0.11, 0.12, 0.15),
  body: rgb(0.16, 0.17, 0.2),
  subtle: rgb(0.42, 0.44, 0.48),
  faint: rgb(0.6, 0.62, 0.66),
  rule: rgb(0.74, 0.76, 0.8),
  accent: rgb(0.15, 0.22, 0.36), // navy
  tableHeader: rgb(0.93, 0.94, 0.96),
  tableStripe: rgb(0.97, 0.975, 0.985),
  watermark: rgb(0.82, 0.16, 0.16),
};

// --------------------------------- fonts -----------------------------------

export interface DocFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
}

// --------------------------------- options ---------------------------------

export interface DocBuilderOptions {
  /** Document title shown in the header (right side). */
  title: string;
  /** Company / firm name shown top-left in the header. */
  companyName: string;
  /** Optional smaller subtitle under the company name (e.g. address). */
  companySubtitle?: string;
  /** When set, draws this text as a diagonal watermark on every page. */
  watermark?: string | null;
  /** ISO timestamp shown in the footer ("Generated ..."). Defaults to now. */
  generatedAt?: string;
}

// --------------------------- table column config ---------------------------

export type CellAlign = "left" | "right" | "center";

export interface TableColumn {
  header: string;
  /** Relative or absolute width. Widths are normalized to the content width. */
  width: number;
  align?: CellAlign;
}

export type TableCell = string | { text: string; align?: CellAlign; bold?: boolean };

export interface TableOptions {
  columns: TableColumn[];
  rows: TableCell[][];
  fontSize?: number;
  headerFontSize?: number;
  zebra?: boolean;
}

// ----------------------------- text helpers --------------------------------

function normalizeCell(cell: TableCell): { text: string; align?: CellAlign; bold?: boolean } {
  return typeof cell === "string" ? { text: cell } : cell;
}

// ------------------------------- DocBuilder --------------------------------

/**
 * Stateful page builder. Create with `DocBuilder.create(...)`, add content
 * top-to-bottom, then call `finish()` to stamp header/footer/watermark on
 * every page and return the encoded bytes.
 */
export class DocBuilder {
  readonly doc: PDFDocument;
  readonly fonts: DocFonts;
  private readonly opts: DocBuilderOptions;
  private readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = CONTENT_TOP;

  private constructor(doc: PDFDocument, fonts: DocFonts, opts: DocBuilderOptions) {
    this.doc = doc;
    this.fonts = fonts;
    this.opts = opts;
    this.addPage();
  }

  static async create(opts: DocBuilderOptions): Promise<DocBuilder> {
    const doc = await PDFDocument.create();
    const fonts: DocFonts = {
      regular: await doc.embedFont(StandardFonts.TimesRoman),
      bold: await doc.embedFont(StandardFonts.TimesRomanBold),
      italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
      boldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
      sans: await doc.embedFont(StandardFonts.Helvetica),
      sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    return new DocBuilder(doc, fonts, opts);
  }

  // ------------------------------ paging -----------------------------------

  private addPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = CONTENT_TOP;
  }

  /** Ensure at least `needed` vertical points remain; page-break otherwise. */
  ensureSpace(needed: number): void {
    if (this.y - needed < CONTENT_BOTTOM) this.addPage();
  }

  get cursorY(): number {
    return this.y;
  }

  moveDown(points: number): void {
    this.y -= points;
  }

  // ---------------------------- measurement --------------------------------

  private widthOf(text: string, font: PDFFont, size: number): number {
    // pdf-lib throws on characters outside WinAnsi; sanitize defensively.
    return font.widthOfTextAtSize(sanitize(text), size);
  }

  /** Word-wrap `text` to `maxWidth`, honoring explicit newlines. */
  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const out: string[] = [];
    const paragraphs = sanitize(text).split("\n");
    for (const para of paragraphs) {
      if (para === "") {
        out.push("");
        continue;
      }
      const words = para.split(/\s+/).filter((w) => w.length > 0);
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (this.widthOf(test, font, size) <= maxWidth) {
          line = test;
          continue;
        }
        if (line) out.push(line);
        if (this.widthOf(word, font, size) > maxWidth) {
          // Break a single over-long token character by character.
          let chunk = "";
          for (const ch of word) {
            if (this.widthOf(chunk + ch, font, size) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
      out.push(line);
    }
    return out.length ? out : [""];
  }

  // ------------------------------ drawing ----------------------------------

  private drawLine(
    text: string,
    x: number,
    font: PDFFont,
    size: number,
    color: RGB,
  ): void {
    this.page.drawText(sanitize(text), { x, y: this.y, size, font, color });
  }

  /** Large centered document title (usually drawn once at the top). */
  documentTitle(text: string, opts?: { size?: number; subtitle?: string }): void {
    const size = opts?.size ?? 16;
    this.ensureSpace(size + 14);
    const width = this.widthOf(text, this.fonts.bold, size);
    const x = MARGIN + (CONTENT_W - width) / 2;
    this.page.drawText(sanitize(text), {
      x,
      y: this.y,
      size,
      font: this.fonts.bold,
      color: COLORS.ink,
    });
    this.y -= size + 4;
    if (opts?.subtitle) {
      const subSize = 9.5;
      const sw = this.widthOf(opts.subtitle, this.fonts.italic, subSize);
      this.page.drawText(sanitize(opts.subtitle), {
        x: MARGIN + (CONTENT_W - sw) / 2,
        y: this.y,
        size: subSize,
        font: this.fonts.italic,
        color: COLORS.subtle,
      });
      this.y -= subSize + 4;
    }
    this.y -= 10;
  }

  /** Section heading (left aligned, bold, with a thin underline rule). */
  heading(text: string, opts?: { size?: number; gapBefore?: number; gapAfter?: number }): void {
    const size = opts?.size ?? 11.5;
    this.moveDown(opts?.gapBefore ?? 12);
    this.ensureSpace(size + 12);
    this.drawLine(text.toUpperCase(), MARGIN, this.fonts.bold, size, COLORS.accent);
    this.y -= size + 3;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: COLORS.rule,
    });
    this.y -= opts?.gapAfter ?? 10;
  }

  /** A flowing paragraph, wrapped to the content width. */
  paragraph(
    text: string,
    opts?: {
      size?: number;
      font?: PDFFont;
      color?: RGB;
      indent?: number;
      lineGap?: number;
      gapAfter?: number;
      align?: CellAlign;
    },
  ): void {
    const size = opts?.size ?? 10.5;
    const font = opts?.font ?? this.fonts.regular;
    const color = opts?.color ?? COLORS.body;
    const indent = opts?.indent ?? 0;
    const lineHeight = size + (opts?.lineGap ?? 4);
    const maxW = CONTENT_W - indent;
    const lines = this.wrap(text, font, size, maxW);
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      let x = MARGIN + indent;
      if (opts?.align === "right") {
        x = PAGE_W - MARGIN - this.widthOf(line, font, size);
      } else if (opts?.align === "center") {
        x = MARGIN + indent + (maxW - this.widthOf(line, font, size)) / 2;
      }
      this.page.drawText(sanitize(line), { x, y: this.y, size, font, color });
      this.y -= lineHeight;
    }
    this.y -= opts?.gapAfter ?? 6;
  }

  /** Bulleted list item. */
  bullet(text: string, opts?: { size?: number; marker?: string }): void {
    const size = opts?.size ?? 10.5;
    const marker = opts?.marker ?? "•";
    const font = this.fonts.regular;
    const lineHeight = size + 4;
    const bulletW = this.widthOf(`${marker} `, font, size);
    const lines = this.wrap(text, font, size, CONTENT_W - 16 - bulletW);
    lines.forEach((line, i) => {
      this.ensureSpace(lineHeight);
      if (i === 0) {
        this.page.drawText(sanitize(marker), {
          x: MARGIN + 8,
          y: this.y,
          size,
          font,
          color: COLORS.accent,
        });
      }
      this.page.drawText(sanitize(line), {
        x: MARGIN + 8 + bulletW,
        y: this.y,
        size,
        font,
        color: COLORS.body,
      });
      this.y -= lineHeight;
    });
    this.y -= 2;
  }

  /** Numbered list item (caller supplies the number). */
  numbered(index: number, text: string, opts?: { size?: number }): void {
    this.bullet(text, { size: opts?.size, marker: `${index}.` });
  }

  /** A checklist row: an empty checkbox followed by wrapped label text. */
  checkbox(text: string, opts?: { size?: number; checked?: boolean }): void {
    const size = opts?.size ?? 10.5;
    const boxSize = size - 1;
    const font = this.fonts.regular;
    const gap = 8;
    const labelX = MARGIN + boxSize + gap;
    const lineHeight = size + 5;
    const lines = this.wrap(text, font, size, PAGE_W - MARGIN - labelX);
    this.ensureSpace(lineHeight);
    // box aligned to the first text baseline
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 1,
      width: boxSize,
      height: boxSize,
      borderColor: COLORS.subtle,
      borderWidth: 0.9,
      color: rgb(1, 1, 1),
    });
    if (opts?.checked) {
      this.page.drawText("X", {
        x: MARGIN + 1.5,
        y: this.y - 0.5,
        size: boxSize,
        font: this.fonts.bold,
        color: COLORS.ink,
      });
    }
    lines.forEach((line, i) => {
      if (i > 0) this.ensureSpace(lineHeight);
      this.page.drawText(sanitize(line), {
        x: labelX,
        y: this.y,
        size,
        font,
        color: COLORS.body,
      });
      this.y -= lineHeight;
    });
    this.y -= 3;
  }

  /** A label : value pair on one line (value wraps under if too long). */
  labelValue(label: string, value: string, opts?: { size?: number; labelWidth?: number }): void {
    const size = opts?.size ?? 10.5;
    const labelWidth = opts?.labelWidth ?? 150;
    const lineHeight = size + 5;
    this.ensureSpace(lineHeight);
    this.page.drawText(sanitize(label), {
      x: MARGIN,
      y: this.y,
      size,
      font: this.fonts.bold,
      color: COLORS.ink,
    });
    const valueX = MARGIN + labelWidth;
    const lines = this.wrap(value || "—", this.fonts.regular, size, PAGE_W - MARGIN - valueX);
    lines.forEach((line, i) => {
      if (i > 0) this.ensureSpace(lineHeight);
      this.page.drawText(sanitize(line), {
        x: valueX,
        y: this.y,
        size,
        font: this.fonts.regular,
        color: COLORS.body,
      });
      this.y -= lineHeight;
    });
  }

  /** A ruled fill-in line: "Label: __________________". */
  fillLine(label: string, opts?: { size?: number; lineWidth?: number; gapAfter?: number }): void {
    const size = opts?.size ?? 10.5;
    const lineHeight = size + 10;
    this.ensureSpace(lineHeight);
    this.page.drawText(sanitize(label), {
      x: MARGIN,
      y: this.y,
      size,
      font: this.fonts.regular,
      color: COLORS.body,
    });
    const labelW = this.widthOf(label, this.fonts.regular, size);
    const startX = MARGIN + labelW + 6;
    const endX =
      opts?.lineWidth != null ? Math.min(startX + opts.lineWidth, PAGE_W - MARGIN) : PAGE_W - MARGIN;
    this.page.drawLine({
      start: { x: startX, y: this.y - 1 },
      end: { x: endX, y: this.y - 1 },
      thickness: 0.75,
      color: COLORS.subtle,
    });
    this.y -= opts?.gapAfter ?? lineHeight;
  }

  /** Two ruled fill-in fields side by side (e.g. Date / Time). */
  fillLinePair(leftLabel: string, rightLabel: string, opts?: { size?: number }): void {
    const size = opts?.size ?? 10.5;
    const lineHeight = size + 12;
    this.ensureSpace(lineHeight);
    const half = CONTENT_W / 2;
    const draw = (label: string, baseX: number, maxX: number) => {
      this.page.drawText(sanitize(label), {
        x: baseX,
        y: this.y,
        size,
        font: this.fonts.regular,
        color: COLORS.body,
      });
      const lw = this.widthOf(label, this.fonts.regular, size);
      this.page.drawLine({
        start: { x: baseX + lw + 6, y: this.y - 1 },
        end: { x: maxX, y: this.y - 1 },
        thickness: 0.75,
        color: COLORS.subtle,
      });
    };
    draw(leftLabel, MARGIN, MARGIN + half - 14);
    draw(rightLabel, MARGIN + half + 4, PAGE_W - MARGIN);
    this.y -= lineHeight;
  }

  /** Signature block: a ruled line with caption lines beneath it. */
  signatureBlock(lines: string[], opts?: { width?: number; gapBefore?: number }): void {
    const width = opts?.width ?? 260;
    this.moveDown(opts?.gapBefore ?? 20);
    this.ensureSpace(18 + lines.length * 14);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + width, y: this.y },
      thickness: 0.9,
      color: COLORS.ink,
    });
    this.y -= 13;
    for (const line of lines) {
      this.ensureSpace(13);
      this.page.drawText(sanitize(line), {
        x: MARGIN,
        y: this.y,
        size: 9.5,
        font: this.fonts.regular,
        color: COLORS.subtle,
      });
      this.y -= 13;
    }
  }

  /** Thin horizontal divider across the content width. */
  divider(opts?: { gapBefore?: number; gapAfter?: number }): void {
    this.moveDown(opts?.gapBefore ?? 6);
    this.ensureSpace(6);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.6,
      color: COLORS.rule,
    });
    this.y -= opts?.gapAfter ?? 8;
  }

  /** Small muted note line. */
  note(text: string, opts?: { size?: number }): void {
    this.paragraph(text, {
      size: opts?.size ?? 8.5,
      font: this.fonts.italic,
      color: COLORS.subtle,
      lineGap: 3,
      gapAfter: 4,
    });
  }

  // ------------------------------- tables ----------------------------------

  table(options: TableOptions): void {
    const fontSize = options.fontSize ?? 9;
    const headerSize = options.headerFontSize ?? 9;
    const padX = 5;
    const padY = 4;
    const zebra = options.zebra ?? true;

    const totalWidth = options.columns.reduce((s, c) => s + c.width, 0);
    const colWidths = options.columns.map((c) => (c.width / totalWidth) * CONTENT_W);
    const colX: number[] = [];
    let acc = MARGIN;
    for (const w of colWidths) {
      colX.push(acc);
      acc += w;
    }

    const drawHeader = () => {
      const rowH = headerSize + padY * 2;
      this.ensureSpace(rowH);
      const top = this.y;
      this.page.drawRectangle({
        x: MARGIN,
        y: top - rowH,
        width: CONTENT_W,
        height: rowH,
        color: COLORS.tableHeader,
      });
      options.columns.forEach((col, i) => {
        const cellW = colWidths[i];
        const tx = this.alignX(col.header, this.fonts.sansBold, headerSize, colX[i], cellW, padX, col.align ?? "left");
        this.page.drawText(sanitize(col.header), {
          x: tx,
          y: top - padY - headerSize + 1,
          size: headerSize,
          font: this.fonts.sansBold,
          color: COLORS.ink,
        });
      });
      this.y = top - rowH;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.6,
        color: COLORS.rule,
      });
    };

    drawHeader();

    options.rows.forEach((row, rowIdx) => {
      // Wrap every cell to determine the row height.
      const wrapped = row.map((cell, i) => {
        const c = normalizeCell(cell);
        return this.wrap(c.text, this.fonts.regular, fontSize, colWidths[i] - padX * 2);
      });
      const maxLines = wrapped.reduce((m, l) => Math.max(m, l.length), 1);
      const rowH = maxLines * (fontSize + 2) + padY * 2;

      if (this.y - rowH < CONTENT_BOTTOM) {
        this.addPage();
        drawHeader();
      }

      const top = this.y;
      if (zebra && rowIdx % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN,
          y: top - rowH,
          width: CONTENT_W,
          height: rowH,
          color: COLORS.tableStripe,
        });
      }
      row.forEach((cell, i) => {
        const c = normalizeCell(cell);
        const font = c.bold ? this.fonts.bold : this.fonts.regular;
        const lines = wrapped[i];
        lines.forEach((line, li) => {
          const ty = top - padY - fontSize + 1 - li * (fontSize + 2);
          const tx = this.alignX(line, font, fontSize, colX[i], colWidths[i], padX, c.align ?? "left");
          this.page.drawText(sanitize(line), {
            x: tx,
            y: ty,
            size: fontSize,
            font,
            color: COLORS.body,
          });
        });
      });
      this.y = top - rowH;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.4,
        color: COLORS.rule,
      });
    });
    this.y -= 8;
  }

  private alignX(
    text: string,
    font: PDFFont,
    size: number,
    colX: number,
    colW: number,
    padX: number,
    align: CellAlign,
  ): number {
    if (align === "right") return colX + colW - padX - this.widthOf(text, font, size);
    if (align === "center") return colX + (colW - this.widthOf(text, font, size)) / 2;
    return colX + padX;
  }

  // ------------------------------ finishing --------------------------------

  private stampHeaderFooter(): void {
    const total = this.pages.length;
    const generatedLabel = `Generated ${formatTimestamp(this.opts.generatedAt)}`;
    const disclaimerLines = this.wrap(LEGAL_DISCLAIMER, this.fonts.italic, 6, CONTENT_W);

    this.pages.forEach((page, idx) => {
      // ---- header ----
      page.drawText(sanitize(this.opts.companyName), {
        x: MARGIN,
        y: PAGE_H - 56,
        size: 11,
        font: this.fonts.sansBold,
        color: COLORS.accent,
      });
      if (this.opts.companySubtitle) {
        page.drawText(sanitize(this.opts.companySubtitle), {
          x: MARGIN,
          y: PAGE_H - 68,
          size: 7.5,
          font: this.fonts.sans,
          color: COLORS.subtle,
        });
      }
      const titleSize = 8.5;
      const titleW = this.widthOf(this.opts.title, this.fonts.sansBold, titleSize);
      page.drawText(sanitize(this.opts.title), {
        x: PAGE_W - MARGIN - titleW,
        y: PAGE_H - 56,
        size: titleSize,
        font: this.fonts.sansBold,
        color: COLORS.subtle,
      });
      page.drawLine({
        start: { x: MARGIN, y: HEADER_LINE_Y },
        end: { x: PAGE_W - MARGIN, y: HEADER_LINE_Y },
        thickness: 1,
        color: COLORS.accent,
      });

      // ---- footer ----
      page.drawLine({
        start: { x: MARGIN, y: FOOTER_LINE_Y },
        end: { x: PAGE_W - MARGIN, y: FOOTER_LINE_Y },
        thickness: 0.75,
        color: COLORS.rule,
      });
      page.drawText(sanitize(generatedLabel), {
        x: MARGIN,
        y: FOOTER_LINE_Y - 11,
        size: 7,
        font: this.fonts.sans,
        color: COLORS.subtle,
      });
      const pageLabel = `Page ${idx + 1} of ${total}`;
      const plW = this.widthOf(pageLabel, this.fonts.sans, 7);
      page.drawText(sanitize(pageLabel), {
        x: PAGE_W - MARGIN - plW,
        y: FOOTER_LINE_Y - 11,
        size: 7,
        font: this.fonts.sans,
        color: COLORS.subtle,
      });
      let dy = FOOTER_LINE_Y - 22;
      for (const line of disclaimerLines) {
        page.drawText(sanitize(line), {
          x: MARGIN,
          y: dy,
          size: 6,
          font: this.fonts.italic,
          color: COLORS.faint,
        });
        dy -= 8;
      }

      // ---- watermark (drawn last, low opacity, on top) ----
      if (this.opts.watermark) {
        const wm = this.opts.watermark;
        const wmSize = 96;
        const wmW = this.widthOf(wm, this.fonts.bold, wmSize);
        page.drawText(sanitize(wm), {
          x: PAGE_W / 2 - (wmW / 2) * Math.cos(Math.PI / 4),
          y: PAGE_H / 2 - (wmW / 2) * Math.sin(Math.PI / 4),
          size: wmSize,
          font: this.fonts.bold,
          color: COLORS.watermark,
          opacity: 0.1,
          rotate: degrees(45),
        });
      }
    });
  }

  async finish(): Promise<{ bytes: Uint8Array; pageCount: number }> {
    this.stampHeaderFooter();
    const bytes = await this.doc.save();
    return { bytes, pageCount: this.pages.length };
  }
}

// ------------------------------ shared utils -------------------------------

/** Replace characters that the StandardFonts (WinAnsi) cannot encode. */
export function sanitize(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u2022/g, "\u2022") // keep bullet (WinAnsi supports it)
    // Drop anything else outside the printable WinAnsi range to be safe.
    .replace(/[^\x09\x0A\x20-\xFF\u2022]/g, "");
}

/** Convert PDF bytes to a fresh, correctly-typed Blob (avoids SAB issues). */
export function bytesToBlob(bytes: Uint8Array): Blob {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}

/** Human-readable footer timestamp. */
export function formatTimestamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
