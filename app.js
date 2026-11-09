import { fetchJob, sheetIdFromLink } from "./sheet.js?v=44";
import { buildPdf, fileName, money, checkInvoiceTotals } from "./render.js?v=44";
import { getPhoto, getOriginal, savePhoto, deletePhoto } from "./photos.js?v=44";
import { cropPhoto } from "./cropper.js?v=44";
import { pastePhoto } from "./paste.js?v=44";
import { SETTING_FIELDS, loadSettings, saveSettings, resetSettings } from "./settings.js?v=44";
import { unlock, lockDevice } from "./lock.js?v=44";

const $ = (sel) => document.querySelector(sel);
const RECENT_KEY = "itchyquote.recent.v1";
const RECENT_MAX = 3;

const AMOUNT_DUE_OPTIONS = [
  { value: "35", text: "35% deposit", label: "AMOUNT DUE" },
  { value: "65", text: "65% balance", label: "AMOUNT DUE" },
  { value: "50", text: "50% deposit", label: "AMOUNT DUE" },
  { value: "25", text: "25% deposit", label: "AMOUNT DUE" },
  { value: "75", text: "75% balance", label: "AMOUNT DUE" },
  { value: "full", text: "Full amount", label: "AMOUNT DUE" },
];

const state = {
  link: "",
  job: null,
  kind: "quotation",
  settings: loadSettings(),
  pdfUrl: null,
  pdfFile: null,
};

// ---------- loading ----------

function showError(message) {
  const el = $("#error");
  el.textContent = message || "";
  el.hidden = !message;
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.text = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.text) {
    button.textContent = button.dataset.text;
  }
  button.disabled = busy;
}

async function load(link) {
  showError("");
  setBusy($("#load-btn"), true, "Loading…");
  try {
    state.job = await fetchJob(link);
    state.link = link;
    $("#sheet-link").value = link;
    $("#show-sub-price").checked = true; // each job starts with subsequent-pc prices shown
    rememberRecent(link, state.job);
    clearResult();
    await renderJob();
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy($("#load-btn"), false);
  }
}

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, RECENT_MAX); } catch { return []; }
}

function rememberRecent(link, job) {
  const entry = { link, title: `${job.company || job.clientName} · Q#${job.quoteNumber}` };
  // Same sheet pasted as different links (…/edit, …/edit?usp=sharing) counts once.
  const id = sheetIdFromLink(link);
  const list = [entry, ...recent().filter((r) => sheetIdFromLink(r.link) !== id)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecent();
}

function renderRecent() {
  const list = recent();
  const box = $("#recent");
  box.hidden = !list.length;
  const chips = document.createElement("div");
  chips.className = "chips";
  chips.append(...list.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = r.title;
    b.title = r.title; // full name on hover when it's cut short
    b.onclick = () => load(r.link);
    return b;
  }));
  box.replaceChildren(
    Object.assign(document.createElement("div"), { className: "section-label", textContent: "Recent" }),
    chips
  );
}

// ---------- job view ----------

async function renderJob() {
  const { job, kind } = state;
  $("#job").hidden = false;
  $("#job-client").textContent = job.clientName || "(no client name)";
  $("#job-company").textContent = job.company;

  document.querySelectorAll(".segmented button").forEach((b) => {
    b.classList.toggle("active", b.dataset.kind === kind);
  });

  const t = job.totals;
  const rows = kind === "quotation"
    ? [
        ["Quotation #", job.quoteNumber],
        ["Date", job.quoteDate],
        ["Products", job.items.map((i) => i.name).join(", ") || "None"],
        ["Total", `S$${money(t.grandTotal)}`],
      ]
    : [
        ["Invoice #", job.invoiceNumber],
        ["Date", job.invoiceDate],
        ["Products", job.items.map((i) => i.name).join(", ") || "None"],
        ["Total", `S$${money(t.grandTotal)}`],
      ];
  $("#job-summary").replaceChildren(...rows.flatMap(([k, v]) => [
    Object.assign(document.createElement("dt"), { textContent: k }),
    Object.assign(document.createElement("dd"), { textContent: v || "—" }),
  ]));

  // Only offered when at least one product has a "Price (sub)" in the sheet.
  $("#quotation-options").hidden = kind !== "quotation" || !job.items.some((i) => i.priceSub > 0);
  $("#invoice-options").hidden = kind !== "invoice";
  $("#amount-due").replaceChildren(...AMOUNT_DUE_OPTIONS.map((o) => {
    const amount = o.value === "full" ? t.grandTotal : t[o.value];
    return new Option(`${o.text} — S$${money(amount)}`, o.value);
  }));

  $("#photo-section").hidden = kind !== "quotation" || !job.items.length;
  await renderPhotos();
}

async function renderPhotos() {
  const list = $("#photo-list");
  const rows = await Promise.all(state.job.items.map(async (item) => {
    const li = document.createElement("li");
    const blob = await getPhoto(item.name);

    const thumb = document.createElement(blob ? "img" : "div");
    thumb.className = "thumb";
    if (blob) thumb.src = URL.createObjectURL(blob);

    const name = Object.assign(document.createElement("span"), { className: "photo-name", textContent: item.name });

    // Picking a photo opens the crop window; nothing is saved if it's cancelled.
    const crop = async (source) => {
      try {
        const result = await cropPhoto(source, item.name);
        if (!result) return;
        await savePhoto(item.name, result);
        clearResult();
        renderPhotos();
      } catch (err) {
        showPhotoError(`Couldn't open that photo: ${err.message}`);
      }
    };

    // Change / Add photo is the main action, in black. It opens the app's own menu, with Paste first.
    const pick = Object.assign(document.createElement("button"), {
      type: "button", className: "button small solid", textContent: blob ? "Change" : "Add photo",
    });
    pick.setAttribute("aria-haspopup", "menu");
    pick.onclick = () => openPhotoMenu(pick, {
      paste: async () => {
        const image = await pastePhoto(item.name);
        if (image) crop(image);
      },
      file: (file) => crop(file),
    });

    // Name and buttons sit together beside the thumbnail; on narrow screens the buttons
    // drop under the name, never under the photo.
    const actions = Object.assign(document.createElement("div"), { className: "photo-actions" });
    const body = Object.assign(document.createElement("div"), { className: "photo-body" });
    body.append(name, actions);
    li.append(thumb, body);
    if (blob) {
      const adjust = Object.assign(document.createElement("button"), {
        type: "button", className: "button small", textContent: "Adjust",
      });
      adjust.onclick = async () => crop(await getOriginal(item.name));
      const remove = Object.assign(document.createElement("button"), {
        type: "button", className: "ghost small trash-btn", title: "Remove photo",
      });
      remove.setAttribute("aria-label", `Remove photo of ${item.name}`);
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/>' +
        '<path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>';
      remove.onclick = async () => { await deletePhoto(item.name); clearResult(); renderPhotos(); };
      actions.append(adjust, pick, remove);
    } else {
      actions.append(pick);
    }
    return li;
  }));
  list.replaceChildren(...rows);
}

const MENU_ICONS = {
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/>' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/>' +
    '<circle cx="12" cy="13.5" r="3.5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
};

function menuItem(tag, icon, text) {
  const el = Object.assign(document.createElement(tag), { className: "photo-menu-item" });
  if (tag === "button") el.type = "button";
  el.setAttribute("role", "menuitem");
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICONS[icon]}</svg>`;
  el.append(text);
  return el;
}

// The Add photo / Change menu: Paste photo, Take photo, Choose file.
// The Photo Library picker gets stuck on some iPhones, so Paste comes first; "Choose file"
// still opens iOS's own menu (Files, Photo Library…) for anything else.
function openPhotoMenu(anchor, { paste, file }) {
  closePhotoMenu();
  showPhotoError("");
  const menu = Object.assign(document.createElement("div"), { className: "photo-menu", id: "photo-menu" });
  menu.setAttribute("role", "menu");

  const pasteItem = menuItem("button", "paste", "Paste photo");
  pasteItem.onclick = () => { closePhotoMenu(); paste(); };
  menu.append(pasteItem);

  // Each picker is a <label> around its file input: the most reliable way to open it on iPhone.
  const picker = (icon, text, attrs) => {
    const label = menuItem("label", icon, text);
    // Listing HEIC stops iOS converting photos to JPEG before handing them over, a slow step
    // that can stall on big camera photos. Safari reads HEIC itself.
    const input = Object.assign(document.createElement("input"), {
      type: "file", accept: "image/*,image/heic,image/heif", hidden: true,
    });
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    input.onchange = () => {
      const picked = input.files[0];
      closePhotoMenu();
      if (picked) file(picked);
    };
    input.oncancel = closePhotoMenu;
    label.append(input);
    menu.append(label);
  };
  picker("camera", "Take photo", { capture: "environment" });
  // Asking for "any file" rather than images makes iOS go straight to Files, skipping its
  // Photo Library / Take photo menu. Non-photos are caught when the crop window opens.
  picker("folder", "Choose file", { accept: "application/octet-stream" });

  anchor.after(menu);
  anchor.setAttribute("aria-expanded", "true");
  // Close when tapping anywhere else.
  setTimeout(() => document.addEventListener("pointerdown", outsideTap), 0);
  document.addEventListener("keydown", escapeKey);
}

function outsideTap(e) {
  if (!e.target.closest("#photo-menu")) closePhotoMenu();
}

function escapeKey(e) {
  if (e.key === "Escape") closePhotoMenu();
}

function closePhotoMenu() {
  const menu = $("#photo-menu");
  if (!menu) return;
  menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  menu.remove();
  document.removeEventListener("pointerdown", outsideTap);
  document.removeEventListener("keydown", escapeKey);
}

function showPhotoError(message) {
  const el = $("#photo-error");
  el.textContent = message;
  el.hidden = !message;
}

// ---------- PDF ----------

function clearResult() {
  $("#result").hidden = true;
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = null;
  state.pdfFile = null;
}

// Shows the invoice's totals check above the preview: green when everything adds up,
// otherwise each problem and the line-by-line sum.
function renderTotalsCheck(check) {
  const box = $("#totals-check");
  box.hidden = !check;
  if (!check) return;
  box.className = `totals-check ${check.ok ? "ok" : "bad"}`;
  const heading = document.createElement("strong");
  heading.textContent = check.ok
    ? `✓ Totals check out: the ${check.lines.length} lines add up to the TOTAL on the invoice.`
    : "⚠ The totals don’t add up. Check the Google Sheet before sending:";
  const parts = [heading];
  if (!check.ok) {
    const problems = document.createElement("ul");
    problems.append(...check.problems.map((p) => Object.assign(document.createElement("li"), { textContent: p })));
    const details = document.createElement("details");
    const summary = Object.assign(document.createElement("summary"), { textContent: "Show the line-by-line sum" });
    const table = document.createElement("table");
    for (const l of [...check.lines, { label: "Lines total", amount: check.lineSum, total: true }]) {
      const row = table.insertRow();
      if (l.total) row.className = "sum";
      row.insertCell().textContent = l.label;
      row.insertCell().textContent = money(l.amount);
    }
    details.append(summary, table);
    parts.push(problems, details);
  }
  box.replaceChildren(...parts);
}

async function makePdf() {
  showError("");
  const button = $("#make-btn");
  setBusy(button, true, "Preparing preview…");
  try {
    const { job, kind, settings } = state;
    const photos = {};
    if (kind === "quotation") {
      for (const item of job.items) {
        const blob = await getPhoto(item.name);
        if (blob) photos[item.name] = new Uint8Array(await blob.arrayBuffer());
      }
    }
    const choice = AMOUNT_DUE_OPTIONS.find((o) => o.value === $("#amount-due").value) || AMOUNT_DUE_OPTIONS[0];
    const amountDue = {
      label: choice.label,
      amount: choice.value === "full" ? job.totals.grandTotal : job.totals[choice.value],
      percent: choice.value === "full" ? 100 : Number(choice.value),
    };

    const showSubPrice = $("#show-sub-price").checked;
    const bytes = await buildPdf(kind, job, { settings, photos, amountDue, showSubPrice });
    const name = fileName(kind, job);
    clearResult();
    state.pdfFile = new File([bytes], name, { type: "application/pdf" });
    state.pdfUrl = URL.createObjectURL(state.pdfFile);

    $("#download-link").href = state.pdfUrl;
    $("#download-link").download = name;
    $("#file-name").textContent = name;
    $("#share-btn").hidden = !(navigator.canShare && navigator.canShare({ files: [state.pdfFile] }));
    renderTotalsCheck(kind === "invoice" ? checkInvoiceTotals(job, amountDue) : null);
    $("#result").hidden = false;
    await renderPreview(bytes);
    $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    showError(`Couldn't create the PDF: ${err.message}`);
  } finally {
    setBusy(button, false);
  }
}

// Draws every page of the PDF as an image on the page, so it can be checked on any device
// before it's downloaded or shared (browsers' own PDF viewers often auto-download or show only page 1).
let pdfjsPromise = null;
async function renderPreview(bytes) {
  pdfjsPromise ??= import("./vendor/pdf.min.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    return pdfjs;
  });
  const pdfjs = await pdfjsPromise;
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  const box = $("#preview-pages");
  box.replaceChildren();
  // Fixed ~1200px-wide pages: sharp on iPhone/iPad screens and readable when pinch-zoomed.
  // (CSS scales them down to fit the screen.)
  const scale = 2;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute("aria-label", `Page ${n} of ${pdf.numPages}`);
    box.append(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  }
  pdf.destroy();
}

async function sharePdf() {
  try {
    await navigator.share({ files: [state.pdfFile], title: state.pdfFile.name });
  } catch (err) {
    if (err.name !== "AbortError") showError(`Couldn't share: ${err.message}`);
  }
}

// ---------- settings ----------

function renderSettings() {
  const box = $("#settings-fields");
  box.replaceChildren(...SETTING_FIELDS.map((field) => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    wrap.append(Object.assign(document.createElement("span"), { textContent: field.label }));
    const input = document.createElement(field.multiline ? "textarea" : "input");
    if (field.multiline) input.rows = field.tall ? 14 : 3;
    input.value = state.settings[field.key];
    input.oninput = () => {
      state.settings[field.key] = input.value;
      saveSettings(state.settings);
      clearResult();
    };
    wrap.append(input);
    return wrap;
  }));
}

// ---------- wiring ----------

$("#load-form").addEventListener("submit", (e) => {
  e.preventDefault();
  load($("#sheet-link").value.trim());
});
$("#reload-btn").onclick = async () => {
  if (!state.link) return;
  const btn = $("#reload-btn");
  btn.classList.add("spinning"); // the icon turns while the sheet reloads
  btn.disabled = true;
  try { await load(state.link); } finally { btn.classList.remove("spinning"); btn.disabled = false; }
};
$("#make-btn").onclick = makePdf;
$("#share-btn").onclick = sharePdf;
$("#amount-due").onchange = clearResult;
$("#show-sub-price").onchange = clearResult;
document.querySelectorAll(".segmented button").forEach((b) => {
  b.onclick = () => { state.kind = b.dataset.kind; clearResult(); renderJob(); };
});
$("#settings-open").onclick = () => { renderSettings(); $("#settings").showModal(); };
$("#settings-reset").onclick = () => {
  if (!confirm("Reset all settings to the original wording?")) return;
  state.settings = resetSettings();
  renderSettings();
  clearResult();
};

$("#settings-lock").onclick = lockDevice;

// Nothing is shown or loaded until the passcode has been entered on this device.
await unlock();
renderRecent();
// Allow opening the app with ?sheet=<link> (handy for bookmarks).
const linked = new URLSearchParams(location.search).get("sheet");
if (linked) load(linked);
