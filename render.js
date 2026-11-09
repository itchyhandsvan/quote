// Builds the quotation / invoice PDFs with pdf-lib.
// Layout measurements (in points, A4 = 595 x 842) were taken from the Figma exports.
// All y values below are measured from the TOP of the page; `toPdfY` flips them for pdf-lib.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const BOTTOM = 828; // content must end above this line
// Set in buildPdf() once pdf-lib is known to be loaded, so a failed library download
// doesn't stop the rest of the app from starting.
let BLACK, WHITE, GREY, RED;

function pdfLib() {
  if (!window.PDFLib || !window.fontkit) {
    throw new Error("The PDF tools didn't load. Refresh the page and try again.");
  }
  const { rgb } = window.PDFLib;
  BLACK = rgb(0, 0, 0);
  WHITE = rgb(1, 1, 1);
  GREY = rgb(0.55, 0.55, 0.55);
  RED = rgb(0.93, 0.11, 0.14);
  return window.PDFLib;
}

// Bundled with the app: Open Sans (SIL Open Font License) and Roboto (Apache 2.0); licences in fonts/.
const FONT_URLS = {
  regular: "fonts/OpenSans-Regular.ttf",
  bold: "fonts/OpenSans-Bold.ttf",
  semibold: "fonts/OpenSans-SemiBold.ttf",
  italic: "fonts/OpenSans-Italic.ttf",
  boldItalic: "fonts/OpenSans-BoldItalic.ttf",
  lightItalic: "fonts/OpenSans-LightItalic.ttf",
  heading: "fonts/Roboto-Bold.ttf", // business name and QUOTATION / INVOICE title (Roboto Bold 700)
};

// Fonts, logo and QR are downloaded once and reused for every PDF.
let assetCache = null;
function loadAssets() {
  if (!assetCache) {
    const bytes = (url) => fetch(url).then((r) => {
      if (!r.ok) throw new Error();
      return r.arrayBuffer();
    }).catch(() => {
      throw new Error(`Couldn't load ${url.split("/").pop()}. Refresh the page and try again.`);
    });
    const fontEntries = Object.entries(FONT_URLS).map(async ([k, url]) => [k, await bytes(url)]);
    assetCache = Promise.all([
      Promise.all(fontEntries).then(Object.fromEntries),
      fetch("assets/logo.svg").then((r) => r.text()),
      bytes("assets/paynow-qr.png"),
    ]).then(([fonts, logoSvg, qr]) => ({ fonts, logoPaths: parseSvgPaths(logoSvg), qr }));
    assetCache.catch(() => { assetCache = null; });
  }
  return assetCache;
}

function parseSvgPaths(svg) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return [...doc.querySelectorAll("path")].map((p) => ({
    d: p.getAttribute("d"),
    white: (p.getAttribute("fill") || "").toLowerCase() === "white",
  }));
}

// ---------- text helpers ----------

export function money(n) {
  return Number(n || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Matches the Figma text style "Title Case": capitalise the first letter of every word.
function titleCase(s) {
  return s.replace(/(^|[\s(\-\/])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
}

// Joins short bracketed groups like "(8 Pcs)" into one word so they never split across lines.
function keepBracketsTogether(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith("(") && !words[i].includes(")")) {
      const end = words.findIndex((w, j) => j > i && w.includes(")"));
      if (end !== -1 && end - i <= 2) {
        out.push(words.slice(i, end + 1).join(" "));
        i = end;
        continue;
      }
    }
    out.push(words[i]);
  }
  return out;
}

function wrap(text, font, size, maxWidth) {
  const out = [];
  for (const paragraph of String(text).split("\n")) {
    const words = keepBracketsTogether(paragraph.split(/\s+/).filter(Boolean));
    if (!words.length) { out.push(""); continue; }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// Wraps each entry of a plain list (e.g. labour steps) to fit the column; returns all the lines.
function wrapEach(list, font, size, maxWidth) {
  return list.flatMap((t) => wrap(t, font, size, maxWidth));
}

// Bulleted lists: long entries wrap with their continuation lines indented under the text.
const BULLET_INDENT = 14;
function wrapBullets(list, font, size, maxWidth) {
  return list.map((t) => wrap(t, font, size, maxWidth - BULLET_INDENT));
}

// ---------- page writer ----------

class Writer {
  constructor(doc, assets, fonts, kind) {
    this.doc = doc;
    this.assets = assets;
    this.f = fonts;
    this.kind = kind; // "quotation" | "invoice"
    this.page = null;
    this.y = 0;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    return this.page;
  }

  text(str, x, top, size, font, { color = BLACK, align = "left", spacing = 0 } = {}) {
    if (!str) return;
    const width = this.width(str, size, font, spacing);
    const left = align === "right" ? x - width : x;
    const baseline = PAGE_H - top - size * 0.95;
    if (!spacing) {
      this.page.drawText(str, { x: left, y: baseline, size, font, color });
      return;
    }
    let cx = left;
    for (const ch of str) {
      this.page.drawText(ch, { x: cx, y: baseline, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + spacing;
    }
  }

  width(str, size, font, spacing = 0) {
    return font.widthOfTextAtSize(str, size) + spacing * Math.max(0, [...str].length - 1);
  }

  lines(arr, x, top, size, font, leading, opts) {
    arr.forEach((l, i) => this.text(l, x, top + i * leading, size, font, opts));
    return arr.length * leading;
  }

  // Draws the output of wrapBullets(); returns the height used.
  bullets(wrapped, x, top, size, font, leading) {
    let y = top;
    for (const entry of wrapped) {
      this.text("•", x + 5, y, size, font);
      y += this.lines(entry, x + BULLET_INDENT, y, size, font, leading);
    }
    return y - top;
  }

  bar(top, height) {
    this.page.drawRectangle({ x: 31, y: PAGE_H - top - height, width: 536, height, color: BLACK });
  }

  rule(top) {
    this.page.drawLine({
      start: { x: 31, y: PAGE_H - top }, end: { x: 567, y: PAGE_H - top },
      thickness: 0.6, color: GREY,
    });
  }

  // Business header shared by both documents: website, Instagram and phone
  // (no business address or email). Blank fields in Settings are skipped.
  letterhead(top) {
    const { f, page } = this;
    const size = 83;
    for (const p of this.assets.logoPaths) {
      page.drawSvgPath(p.d, { x: 49, y: PAGE_H - top, scale: size / 82, color: p.white ? WHITE : BLACK });
    }
    const s = this.settings;
    this.text(s.businessName, 153, top + 2, 12.5, f.heading, { spacing: 0.6 });
    this.text(s.tagline, 153, top + 15, 8.6, f.regular);
    const mission = wrap(s.mission, f.lightItalic, 7, 143);
    const MISSION_LEAD = 10.1;
    this.lines(mission, 412, top + 3, 7, f.lightItalic, MISSION_LEAD);
    // The contact lines are stacked upwards from the phone number, whose baseline lines up
    // with the last line of the mission statement.
    const missionBaseline = top + 3 + (mission.length - 1) * MISSION_LEAD + 7 * 0.95;
    const phoneTop = missionBaseline - 7.4 * 0.95;
    const contact = [s.website, s.instagram, s.phone].map((v) => (v || "").trim()).filter(Boolean);
    const lead = 11;
    this.lines(contact, 153, phoneTop - (contact.length - 1) * lead, 7.4, f.regular, lead);
  }

  // Lays out blocks, starting a new page (with the table header) when one doesn't fit.
  // A block marked keepWithNext (a section header like "Mould & Testing") moves to the
  // next page together with the row after it, so a header is never left alone at the bottom.
  flow(blocks, continuationTop) {
    blocks.forEach((block, i) => {
      let needed = block.height;
      for (let j = i; blocks[j]?.keepWithNext && blocks[j + 1]; j++) {
        needed += (blocks[j].gapAfter ?? 0) + blocks[j + 1].height;
      }
      if (this.y + needed > BOTTOM) {
        this.addPage();
        this.y = this.tableHeader(continuationTop);
      }
      block.draw(this.y);
      this.y += block.height + (block.gapAfter ?? 0);
    });
  }
}

// ---------- quotation ----------

const Q = { c1: 51, c2: 185, c3: 416, c4: 464, descWidth: 215, body: 8.6, lead: 12 };

function quotationTableHeader(w, top) {
  w.bar(top, 22);
  const t = top + 6;
  w.text("ITEM", Q.c1, t, 9.6, w.f.regular, { color: WHITE });
  w.text("DESCRIPTION", Q.c2, t, 9.6, w.f.regular, { color: WHITE });
  w.text("QTY", Q.c3, t, 9.6, w.f.regular, { color: WHITE });
  w.text("ESTIMATE (SGD)", Q.c4, t, 9.6, w.f.regular, { color: WHITE });
  return top + 22 + 26;
}

function quotationBlocks(w, job, photos, showSubPrice) {
  const { f } = w;
  const s = w.settings;
  const blocks = [];
  const { body, lead } = Q;

  // Scope of work
  {
    const label = s.scopeLabel.split("\n");
    const desc = wrap(s.scopeText, f.italic, body, Q.descWidth);
    const height = 22 + Math.max(label.length, desc.length) * lead;
    blocks.push({
      height, gapAfter: 34,
      draw: (top) => {
        w.text("Scope of Work", Q.c1, top, 10.4, f.bold);
        w.lines(label, Q.c1, top + 22, body, f.bold, lead);
        w.lines(desc, Q.c2, top + 22, body, f.italic, lead);
      },
    });
  }

  // Products
  for (const item of job.items) {
    const name = wrap(item.name, f.bold, body, Q.descWidth);
    const details = wrapEach(item.details.map(titleCase), f.regular, body, Q.descWidth);
    const ingredients = wrapBullets(item.ingredients.map(titleCase), f.regular, body, Q.descWidth);
    const descHeight =
      name.length * lead + lead + 5 + details.length * lead +
      (ingredients.length ? 6 + lead + ingredients.flat().length * lead : 0);
    const photo = photos[item.name];
    blocks.push({
      height: Math.max(descHeight, photo ? 92 : 0), gapAfter: 42,
      draw: (top) => {
        if (photo) {
          w.page.drawImage(photo, { x: Q.c1, y: PAGE_H - top - 90, width: 111, height: 90 });
        }
        let y = top;
        y += w.lines(name, Q.c2, y, body, f.bold, lead);
        w.text("Construction time and labour:", Q.c2, y, body, f.italic); y += lead + 5;
        y += w.lines(details, Q.c2, y, body, f.regular, lead);
        if (ingredients.length) {
          y += 6;
          w.text("Ingredients", Q.c2, y, body, f.italic); y += lead;
          w.bullets(ingredients, Q.c2, y, body, f.regular, lead);
        }
        w.text(String(item.quantity), Q.c3, top, body, f.bold);
        // Items with no "Price (sub)" (or with the switch off) show one flat price, without the "(first pc)" label.
        if (showSubPrice && item.priceSub > 0) {
          priceLine(w, item.priceFirst, "(first pc)", top);
          priceLine(w, item.priceSub, "(subsequent pc)", top + 14);
        } else {
          w.text(money(item.priceFirst), Q.c4, top, body, f.bold);
        }
      },
    });
  }

  // Moulds
  if (job.moulds.length) {
    blocks.push({
      ...labelledRow(w, "Mould & Testing", wrap(s.mouldText, f.italic, body, Q.descWidth), f.italic, 22),
      keepWithNext: true,
    });
    job.moulds.forEach((m, i) => {
      const last = i === job.moulds.length - 1;
      const name = wrap(m.name, f.bold, body, Q.descWidth);
      const details = wrapBullets(m.details, f.regular, body, Q.descWidth);
      const height = name.length * lead + 5 + details.flat().length * lead;
      blocks.push({
        height, gapAfter: last ? 48 : 20,
        draw: (top) => {
          const y = top + w.lines(name, Q.c2, top, body, f.bold, lead) + 5;
          w.text(money(m.price * m.quantity), Q.c4, top, body, f.bold);
          w.bullets(details, Q.c2, y, body, f.regular, lead);
        },
      });
    });
  }

  // Special effects
  if (job.effects.length) {
    job.effects.forEach((e, i) => {
      const name = wrap(e.name, f.bold, body, Q.descWidth);
      const detail = wrap(e.detail, f.italic, body, Q.descWidth);
      blocks.push({
        height: (name.length + detail.length) * lead, gapAfter: i === job.effects.length - 1 ? 40 : 20,
        draw: (top) => {
          if (i === 0) w.text("Special Effects", Q.c1, top, body, f.bold);
          const y = top + w.lines(name, Q.c2, top, body, f.bold, lead);
          w.lines(detail, Q.c2, y, body, f.italic, lead);
          w.text(money(e.price), Q.c4, top, body, f.bold);
        },
      });
    });
  }

  // Notes to client
  if (job.notes.length) {
    const noteLines = job.notes.flatMap((n) => wrap(n, f.boldItalic, body, Q.descWidth));
    blocks.push(labelledRow(w, "*Notes to Client", noteLines, f.boldItalic, 34));
  }

  // Delivery
  if (job.deliveryPrice > 0) {
    blocks.push({
      ...labelledRow(w, "Delivery & Shipping", wrap(s.deliveryText, f.italic, body, Q.descWidth), f.italic, 22),
      keepWithNext: true,
    });
    blocks.push({
      height: lead, gapAfter: 40,
      draw: (top) => {
        w.text("Delivery of products", Q.c2, top, body, f.bold);
        w.text(money(job.deliveryPrice), Q.c4, top, body, f.bold);
      },
    });
  }

  // The rush fee / discount rows fill whatever space is left on the page. Timeline is tied
  // to the closing section (total, T&Cs, signature), which always stays together on one page.
  const adj = job.adjustment;
  if (adj) {
    const discount = adj.kind === "discount";
    blocks.push({
      height: lead, gapAfter: 18, keepWithNext: true,
      draw: (top) => {
        w.text(discount ? "Discount (%)" : "Rush Job Fee (%)", Q.c1, top, body, f.bold);
        w.text(discount ? "Percentage amount of deduction" : "Percentage amount of top-up", Q.c2, top, body, f.italic);
      },
    });
    blocks.push({
      height: lead, gapAfter: 34,
      draw: (top) => {
        w.text(discount ? "One Time Discount Amount" : "One Time Rush Fee Amount", Q.c2, top, body, f.bold);
        w.text(discount ? `-${adj.percent}` : adj.percent, Q.c4, top, body, f.bold);
      },
    });
  }

  blocks.push({
    height: lead, gapAfter: 21, keepWithNext: true,
    draw: (top) => {
      w.text("Timeline", Q.c1, top, body, f.bold);
      w.text(job.leadTime || "TBC", Q.c2, top, body, f.bold);
    },
  });

  blocks.push(quotationClosing(w, job));
  return blocks;
}

function priceLine(w, amount, suffix, top) {
  const value = money(amount);
  w.text(value, Q.c4, top, Q.body, w.f.bold);
  w.text(suffix, Q.c4 + w.width(value, Q.body, w.f.bold) + 4, top, Q.body, w.f.regular);
}

function labelledRow(w, label, descLines, descFont, gapAfter) {
  return {
    height: Math.max(1, descLines.length) * Q.lead, gapAfter,
    draw: (top) => {
      w.text(label, Q.c1, top, Q.body, w.f.bold);
      w.lines(descLines, Q.c2, top, Q.body, descFont, Q.lead);
    },
  };
}

// "DISCOUNT 15%: (318)" or "RUSH FEE 10%: 362", as in the Figma quotations.
function adjustmentLine(adj) {
  return adj.kind === "discount"
    ? `DISCOUNT ${adj.percent}: (${adj.amount})`
    : `RUSH FEE ${adj.percent}: ${adj.amount}`;
}

// Space on a continuation page below the repeated table header, less the Timeline row
// (12 + 21 gap) that always sits on the same page as the closing section.
const QUOTE_PAGE_ROOM = BOTTOM - (51 + 22 + 26) - 33;

// Rule, validity, totals, T&Cs, payment terms and signature: one section, always kept
// together on one page. If the T&Cs make it taller than a page, the spacing tightens to fit.
function quotationClosing(w, job) {
  const { f } = w;
  const s = w.settings;
  const tWidth = 342;
  const adj = job.adjustment;

  // Tightest last: the gap above the signature line, then the T&C line spacing and size.
  const fits = [
    { tSize: 7.6, tLead: 10.1, sigGap: 62 },
    { tSize: 7.6, tLead: 10.1, sigGap: 44 },
    { tSize: 7.4, tLead: 9.6, sigGap: 44 },
    { tSize: 7.2, tLead: 9.2, sigGap: 40 },
  ];
  let paragraphs, payment, height, tSize, tLead, sigGap;
  for (const fit of fits) {
    ({ tSize, tLead, sigGap } = fit);
    paragraphs = s.terms.split(/\n\s*\n/).map((p) => wrap(p.trim(), f.italic, tSize, tWidth));
    payment = s.quotePaymentTerms.split("\n").flatMap((p) => wrap(p, f.italic, tSize, tWidth));
    const termsHeight = paragraphs.reduce((h, p) => h + p.length * tLead + tLead, 0);
    // Mirrors the spacing used in draw() below, down to the bottom of "Print name:".
    height = 30 + (adj ? 29 : 0) + 26 + 16 + termsHeight + 20 + 16 +
      payment.length * tLead + 30 + sigGap + 6 + 12;
    if (height <= QUOTE_PAGE_ROOM) break;
  }

  return {
    height, gapAfter: 0,
    draw: (top) => {
      let y = top;
      w.rule(y);
      y += 30;
      w.text(s.validity, Q.c1, y + 2, 10.4, f.regular);
      if (adj) {
        w.text(`SUBTOTAL: S$${money(job.totals.subtotal)}`, 545, y, 9.2, f.regular, { align: "right" });
        w.text(adjustmentLine(adj), 545, y + 12, 9.2, f.regular, { align: "right", color: RED });
        y += 29;
      }
      w.text(`TOTAL: S$${money(job.totals.grandTotal)}`, 545, y, 13.2, f.bold, { align: "right" });
      y += 26;
      w.text("General Terms & Conditions", Q.c1, y, 8.8, f.semibold);
      y += 16;
      for (const p of paragraphs) y += w.lines(p, Q.c1, y, tSize, f.italic, tLead) + tLead;
      y += 20;
      w.text("Payment terms", Q.c1, y, 8.8, f.semibold);
      y += 16;
      y += w.lines(payment, Q.c1, y, tSize, f.italic, tLead);
      y += 30;
      w.text("Customer acceptance:", Q.c1, y, 8.8, f.semibold);
      y += sigGap;
      w.text("x", Q.c1, y - 8, 8.6, f.regular);
      w.page.drawLine({
        start: { x: Q.c1 + 6, y: PAGE_H - y }, end: { x: 186, y: PAGE_H - y },
        thickness: 0.8, color: BLACK,
      });
      w.text("Print name:", Q.c1, y + 6, 8.6, f.regular);
    },
  };
}

// ---------- invoice ----------

const I = { c1: 51, qty: 358, right: 546, body: 8.6, lead: 12, descWidth: 290 };

function invoiceTableHeader(w, top) {
  w.bar(top, 22);
  const t = top + 6;
  w.text("DESCRIPTION", I.c1, t, 9.6, w.f.regular, { color: WHITE });
  w.text("QTY", I.qty, t, 9.6, w.f.regular, { color: WHITE });
  w.text("AMOUNT (SGD)", I.right, t, 9.6, w.f.regular, { color: WHITE, align: "right" });
  return top + 22 + 28;
}

function itemAmount(item) {
  if (item.quantity <= 1) return item.priceFirst * item.quantity;
  const sub = item.priceSub > 0 ? item.priceSub : item.priceFirst;
  return item.priceFirst + (item.quantity - 1) * sub;
}

const cents = (n) => Math.round(n * 100);

/**
 * Re-adds every line printed on the invoice and compares it with the sheet's totals.
 * Returns { ok, lines: [{label, amount}], problems: [string] }.
 */
export function checkInvoiceTotals(job, amountDue) {
  const lines = [
    ...job.items.map((i) => ({ label: `${i.name} × ${i.quantity}`, amount: itemAmount(i) })),
    ...job.moulds.map((m) => ({ label: `${m.name} × ${m.quantity}`, amount: m.price * m.quantity })),
    ...job.effects.map((e) => ({ label: e.name, amount: e.price })),
    ...(job.deliveryPrice > 0 ? [{ label: "Delivery of products", amount: job.deliveryPrice }] : []),
  ];
  const lineSum = lines.reduce((sum, l) => sum + l.amount, 0);
  const problems = [];
  const t = job.totals;

  const adj = job.adjustment;
  // SUBTOTAL is printed only when there's a rush fee / discount.
  if (adj && cents(t.subtotal) !== cents(lineSum)) {
    problems.push(`The lines add up to S$${money(lineSum)}, but the SUBTOTAL printed is S$${money(t.subtotal)}.`);
  }

  // TOTAL = lines, minus a discount or plus a rush fee.
  const adjAmount = adj ? Number(String(adj.amount).replace(/[^0-9.]/g, "")) || 0 : 0;
  const expected = lineSum + (adj ? (adj.kind === "discount" ? -adjAmount : adjAmount) : 0);
  if (cents(expected) !== cents(t.grandTotal)) {
    const sum = adj
      ? `S$${money(lineSum)} ${adj.kind === "discount" ? "minus the discount" : "plus the rush fee"} of ` +
        `${money(adjAmount)} comes to S$${money(expected)}`
      : `The lines add up to S$${money(lineSum)}`;
    problems.push(
      `${sum}, but the TOTAL printed is S$${money(t.grandTotal)} ` +
      `(difference S$${money(Math.abs(t.grandTotal - expected))}).`
    );
  }

  // Amount due should be the chosen share of the total.
  if (amountDue?.percent) {
    const due = (t.grandTotal * amountDue.percent) / 100;
    if (Math.abs(cents(due) - cents(amountDue.amount)) > 1) {
      problems.push(
        `AMOUNT DUE is S$${money(amountDue.amount)}, but ${amountDue.percent}% of S$${money(t.grandTotal)} is S$${money(due)}.`
      );
    }
  }

  return { ok: problems.length === 0, lines, lineSum, expected, problems };
}

function invoiceBlocks(w, job, amountDue) {
  const { f } = w;
  const { body, lead } = I;
  const blocks = [];

  const amountCells = (top, qty, amount) => {
    w.text(String(qty), I.qty, top, body, f.bold);
    w.text(money(amount), I.right, top, body, f.bold, { align: "right" });
  };
  for (const item of job.items) {
    const name = wrap(item.name, f.bold, body, I.descWidth);
    const details = wrapEach(item.details, f.regular, body, I.descWidth);
    const ingredients = wrapBullets(item.ingredients.map(titleCase), f.regular, body, I.descWidth);
    const height =
      name.length * lead + lead + 5 + details.length * lead +
      (ingredients.length ? 6 + lead + ingredients.flat().length * lead : 0);
    blocks.push({
      height, gapAfter: 36,
      draw: (top) => {
        let y = top;
        y += w.lines(name, I.c1, y, body, f.bold, lead);
        w.text("Construction time and labour:", I.c1, y, body, f.regular); y += lead + 5;
        y += w.lines(details, I.c1, y, body, f.regular, lead);
        if (ingredients.length) {
          y += 6;
          w.text("Ingredients", I.c1, y, body, f.italic); y += lead;
          w.bullets(ingredients, I.c1, y, body, f.regular, lead);
        }
        amountCells(top, item.quantity, itemAmount(item));
      },
    });
  }

  for (const m of job.moulds) {
    const name = wrap(m.name, f.regular, body, I.descWidth);
    const details = wrapBullets(m.details, f.regular, body, I.descWidth);
    blocks.push({
      height: (name.length + details.flat().length) * lead, gapAfter: 36,
      draw: (top) => {
        const y = top + w.lines(name, I.c1, top, body, f.regular, lead);
        w.bullets(details, I.c1, y, body, f.regular, lead);
        amountCells(top, m.quantity, m.price * m.quantity);
      },
    });
  }

  for (const e of job.effects) {
    const name = wrap(e.name, f.regular, body, I.descWidth);
    const detail = wrap(e.detail, f.italic, body, I.descWidth);
    blocks.push({
      height: (name.length + detail.length) * lead, gapAfter: 36,
      draw: (top) => {
        const y = top + w.lines(name, I.c1, top, body, f.regular, lead);
        w.lines(detail, I.c1, y, body, f.italic, lead);
        amountCells(top, 1, e.price);
      },
    });
  }

  if (job.deliveryPrice > 0) {
    blocks.push({
      height: lead, gapAfter: 36,
      draw: (top) => {
        w.text("Delivery of products", I.c1, top, body, f.regular);
        amountCells(top, 1, job.deliveryPrice);
      },
    });
  }

  blocks.push(invoiceFooter(w, job, amountDue));
  return blocks;
}

function invoiceFooter(w, job, amountDue) {
  const { f } = w;
  const s = w.settings;
  const terms = s.invoicePaymentTerms.split("\n").flatMap((p) => wrap(p, f.italic, 8, 300));
  const adj = job.adjustment;
  return {
    height: 30 + Math.max(terms.length * 11 + 14, adj ? 70 : 40) + 30 + 28 + 104,
    gapAfter: 0,
    draw: (top) => {
      let y = top - 8;
      w.rule(y);
      y += 30;
      w.text("Payment terms:", I.c1, y, 8, f.bold);
      w.lines(terms, I.c1, y + 12, 8, f.italic, 11);
      let ry = y - 2;
      if (adj) {
        w.text(`SUBTOTAL: S$${money(job.totals.subtotal)}`, I.right, ry, 9.2, f.regular, { align: "right" });
        w.text(adjustmentLine(adj), I.right, ry + 12, 9.2, f.regular, { align: "right", color: RED });
        ry += 30;
      }
      w.text(`TOTAL: S$${money(job.totals.grandTotal)}`, I.right, ry, 10.6, f.bold, { align: "right" });
      w.text(`${amountDue.label}: S$${money(amountDue.amount)}`, I.right, ry + 17, 13.4, f.bold, { align: "right" });
      y = Math.max(y + terms.length * 11 + 14, ry + 40) + 30;
      w.text(s.businessName, I.c1, y, 10.4, f.bold);
      w.text(s.uen, I.c1, y + 14, 10.4, f.bold);
      w.page.drawImage(w.qr, { x: I.c1 + 1, y: PAGE_H - (y + 32) - 102, width: 102, height: 102 });
    },
  };
}

// ---------- public ----------

/**
 * @param kind "quotation" | "invoice"
 * @param job  result of parseJob()
 * @param options { settings, photos: {itemName: Uint8Array jpeg}, amountDue: {label, amount} }
 */
export async function buildPdf(kind, job, { settings, photos = {}, amountDue, showSubPrice = true }) {
  const { PDFDocument } = pdfLib();
  const assets = await loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);

  const fonts = {};
  await Promise.all(Object.entries(assets.fonts).map(async ([k, b]) => {
    fonts[k] = await doc.embedFont(b, { subset: true });
  }));

  const w = new Writer(doc, assets, fonts, kind);
  w.settings = settings;
  w.qr = await doc.embedPng(assets.qr);

  const embedded = {};
  if (kind === "quotation") {
    for (const item of job.items) {
      if (photos[item.name]) embedded[item.name] = await doc.embedJpg(photos[item.name]);
    }
  }

  w.addPage();
  w.letterhead(51);

  // The sheet's "Address" cell can hold several lines (company, street, unit, postcode).
  // Everything below the client block moves down to make room for them.
  const addressLines = job.addressLines.length ? job.addressLines : [""];
  const ADDRESS_LEAD = 14;

  if (kind === "quotation") {
    doc.setTitle(`Quotation #${job.quoteNumber} – ${job.company}`);
    w.text("QUOTATION", Q.c1, 173, 18, fonts.heading, { spacing: 0.2 });
    w.text(job.clientName, Q.c1, 236, 10.8, fonts.semibold);
    w.lines(addressLines, Q.c1, 250, 10.8, fonts.regular, ADDRESS_LEAD);
    // Date and quotation number line up with the last two lines of the client block.
    const lastTop = 250 + (addressLines.length - 1) * ADDRESS_LEAD;
    w.text(`Date: ${job.quoteDate}`, 548, lastTop - ADDRESS_LEAD, 10.8, fonts.semibold, { align: "right" });
    w.text(`Quotation #${job.quoteNumber}`, 548, lastTop, 10.8, fonts.regular, { align: "right" });
    w.tableHeader = (top) => quotationTableHeader(w, top);
    w.y = w.tableHeader(lastTop + 30);
    w.flow(quotationBlocks(w, job, embedded, showSubPrice), 51);
  } else {
    doc.setTitle(`Invoice #${job.invoiceNumber} – ${job.company}`);
    w.text("INVOICE", I.c1, 150, 18, fonts.heading, { spacing: 0.2 });
    w.text(job.clientName, I.c1, 200, 10.8, fonts.semibold);
    w.lines(addressLines, I.c1, 214, 10.8, fonts.regular, ADDRESS_LEAD);
    const dateTop = 214 + (addressLines.length - 1) * ADDRESS_LEAD + 37;
    w.text(`Date: ${job.invoiceDate}`, I.c1, dateTop, 10.8, fonts.semibold);
    w.text(`INVOICE NO. #${job.invoiceNumber}`, I.right, dateTop, 10.8, fonts.semibold, { align: "right" });
    w.tableHeader = (top) => invoiceTableHeader(w, top);
    w.y = w.tableHeader(dateTop + 25);
    w.flow(invoiceBlocks(w, job, amountDue), 31);
  }

  doc.setAuthor(settings.businessName);
  return doc.save();
}

export function fileName(kind, job) {
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "").trim();
  return kind === "quotation"
    ? `Quotation #${clean(job.quoteNumber)}_${clean(job.company)}.pdf`
    : `Invoice #${clean(job.invoiceNumber)}_${clean(job.company)}.pdf`;
}
