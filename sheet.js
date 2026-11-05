// Reads the "Properties" tab of a job's Google Sheet and turns it into a job object.
// The sheet must be shared as "Anyone with the link can view".

const TAB_NAME = "Properties";

export function sheetIdFromLink(link) {
  const match = String(link).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Allow pasting the bare ID too.
  if (/^[a-zA-Z0-9_-]{25,}$/.test(link.trim())) return link.trim();
  return null;
}

export async function fetchJob(link) {
  const id = sheetIdFromLink(link);
  if (!id) throw new Error("That doesn't look like a Google Sheets link.");

  const url =
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq` +
    `?tqx=out:csv&headers=1&sheet=${encodeURIComponent(TAB_NAME)}`;

  // Give up after 20 seconds rather than leaving the Load button stuck.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response, text;
  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal });
    text = await response.text();
  } catch (err) {
    throw new Error(
      err.name === "AbortError"
        ? "Google Sheets took too long to answer. Check your internet connection and try again."
        : `Couldn't reach Google Sheets (${err.message}). Your network may be blocking ` +
          "docs.google.com — try another Wi-Fi or mobile data."
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || text.trimStart().startsWith("<")) {
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1];
    throw new Error(
      "Couldn't read the sheet. Make sure it's shared as \"Anyone with the link can view\" " +
      `and has a tab called "${TAB_NAME}". ` +
      `(Google replied: ${response.status}${title ? ` “${title.trim()}”` : ""})`
    );
  }
  return parseJob(parseCSV(text));
}

// Minimal RFC 4180 CSV parser (handles quoted fields with commas, quotes and newlines).
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "1,310.00" / "S$650" / "" -> number
export function toNumber(value) {
  const n = parseFloat(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function lines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Placeholder rows in the template look like "Item 6", "Note 4", "Mould name 5", "Details 1"...
function isPlaceholder(value) {
  return /^(item|note|mould name|mould details|ingredients|special effects name|details)\s*\d+$/i
    .test(String(value ?? "").trim());
}

// The Discount columns hold either a discount or a rush fee:
//   discount: Disc Amount "15%",  Disc total "318"   -> DISCOUNT 15%: (318)
//   rush fee: Disc Amount "-10%", Disc total "-362"  -> RUSH FEE 10%: 362
function parseAdjustment(percentText, totalText) {
  const total = toNumber(totalText);
  if (!total) return null;
  return {
    kind: total > 0 ? "discount" : "rush",
    percent: String(percentText).replace("-", "").trim(),
    amount: String(totalText).replace("-", "").trim(),
  };
}

export function parseJob(rows) {
  if (rows.length < 2) throw new Error("The Properties tab is empty.");

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((cells) => {
    const get = (name) => {
      const i = headers.indexOf(name.toLowerCase());
      return i === -1 ? "" : (cells[i] ?? "").trim();
    };
    return get;
  });

  const missing = ["Client Name", "Item Name", "Price (first)", "Grand Total"]
    .filter((h) => !headers.includes(h.toLowerCase()));
  if (missing.length) {
    throw new Error(`The Properties tab is missing these columns: ${missing.join(", ")}.`);
  }

  const first = records[0];

  const items = records
    .map((get) => ({
      name: get("Item Name"),
      details: lines(get("Details")),
      ingredients: lines(get("Ingredients")),
      quantity: toNumber(get("Quantity")),
      priceFirst: toNumber(get("Price (first)")),
      priceSub: toNumber(get("Price (sub)")),
    }))
    .filter((item) => item.name && !isPlaceholder(item.name) && item.quantity > 0 && item.priceFirst > 0);

  const moulds = records
    .map((get) => ({
      name: get("Mould name"),
      details: lines(get("Mould details")).filter((d) => !isPlaceholder(d)),
      quantity: toNumber(get("Mould Quantity")) || 1,
      price: toNumber(get("Mould price")),
    }))
    .filter((m) => m.name && !isPlaceholder(m.name) && m.price > 0);

  const effects = records
    .map((get) => ({
      name: get("Special Effects"),
      detail: get("Effect Detail"),
      price: toNumber(get("Effect Price")),
    }))
    .filter((e) => e.name && !isPlaceholder(e.name) && e.price > 0);

  const notes = [...new Set(
    records.map((get) => get("Note")).filter((n) => n && !isPlaceholder(n))
  )];

  return {
    clientName: first("Client Name"),
    // The "Address" cell: first line is the company, any further lines are the street address.
    company: lines(first("Address"))[0] || "",
    addressLines: lines(first("Address")),
    quoteDate: first("Quote Date"),
    quoteNumber: first("Quote number"),
    invoiceDate: first("Invoice Date"),
    invoiceNumber: first("Invoice number"),
    deliveryPrice: toNumber(first("Delivery price")),
    leadTime: first("Lead time"),
    items,
    moulds,
    effects,
    notes,
    adjustment: parseAdjustment(first("Disc Amount"), first("Disc total")),
    // Totals are taken from the sheet exactly as calculated there.
    totals: {
      subtotal: toNumber(first("Subtotal")),
      grandTotal: toNumber(first("Grand Total")),
      "50": toNumber(first("50%")),
      "35": toNumber(first("35%")),
      "25": toNumber(first("25%")),
      "65": toNumber(first("Balance 65%")),
      "75": toNumber(first("Balance 75%")),
    },
  };
}
