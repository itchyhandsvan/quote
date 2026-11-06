// Crop window for product photos. The frame has the same shape as the photo box on the
// quotation (111 x 90), so what's inside the frame is exactly what the PDF shows.
// Drag to move, pinch or use the slider to zoom.

import { FRAME_RATIO, OUTPUT_WIDTH } from "./photos.js?v=37";

const ORIGINAL_MAX = 2400; // originals are scaled down to this to keep storage small
const MAX_ZOOM = 4;

const $ = (sel) => document.querySelector(sel);

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

const OPEN_TIMEOUT = 45000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Decodes with a plain <img>. Full-size iPhone camera photos (24–48 MP) from the Photo Library
// can make createImageBitmap stall forever on iOS Safari; <img> copes with them.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("this photo's format couldn't be read")); };
    img.src = url;
  });
}

async function downscale(file) {
  const { img, url } = await withTimeout(loadImage(file), OPEN_TIMEOUT, "the photo took too long to open");
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("the photo appears to be empty");
    const scale = Math.min(1, ORIGINAL_MAX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 0.9);
    if (!blob) throw new Error("the photo is too large for this device to process");
    return { canvas, blob };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Opens the crop window for an image file/blob.
 * Resolves to { cropped, original } (JPEG Blobs), or null if cancelled.
 */
export async function cropPhoto(file, title) {
  const dialog = $("#cropper");
  const frame = $("#crop-frame");
  const img = $("#crop-image");
  const zoomInput = $("#crop-zoom");
  const loading = $("#crop-loading");
  const useBtn = $("#crop-use");
  $("#crop-title").textContent = title ? `Crop photo · ${title}` : "Crop photo";

  // Open the window straight away with "Opening photo…", so a big photo never looks like a freeze.
  img.removeAttribute("src");
  loading.hidden = false;
  useBtn.disabled = true;
  let cancelled = false;
  $("#crop-cancel").onclick = () => { cancelled = true; dialog.close(); };
  dialog.oncancel = (e) => { e.preventDefault(); cancelled = true; dialog.close(); };
  dialog.showModal();

  let source, original;
  try {
    ({ canvas: source, blob: original } = await downscale(file));
  } catch (err) {
    dialog.close();
    if (cancelled) return null;
    throw err;
  }
  if (cancelled) return null;

  const url = URL.createObjectURL(original);
  const loaded = new Promise((resolve) => { img.onload = img.onerror = resolve; });
  img.src = url;
  await loaded;
  loading.hidden = true;
  useBtn.disabled = false;

  const iw = source.width;
  const ih = source.height;
  // Frame size is read on every update, so rotating the phone or resizing still works.
  const frameSize = () => ({ fw: frame.clientWidth, fh: frame.clientHeight });

  // Image position in "frame units" (0..1 of frame size) so it survives frame resizes.
  let zoom = 1;
  let cx = 0.5; // centre of the frame, as a fraction of the image width
  let cy = 0.5;

  function coverScale() {
    const { fw, fh } = frameSize();
    return Math.max(fw / iw, fh / ih);
  }

  function clamp() {
    const { fw, fh } = frameSize();
    const s = coverScale() * zoom;
    // Before the window has its size, there's nothing to measure; don't turn the position into NaN.
    if (!(s > 0)) return;
    if (!Number.isFinite(cx)) cx = 0.5;
    if (!Number.isFinite(cy)) cy = 0.5;
    const halfW = fw / (2 * s * iw);
    const halfH = fh / (2 * s * ih);
    cx = Math.min(Math.max(cx, halfW), 1 - halfW);
    cy = Math.min(Math.max(cy, halfH), 1 - halfH);
  }

  function render() {
    clamp();
    const { fw, fh } = frameSize();
    const s = coverScale() * zoom;
    const x = fw / 2 - cx * iw * s;
    const y = fh / 2 - cy * ih * s;
    img.style.width = `${iw * s}px`;
    img.style.height = `${ih * s}px`;
    img.style.transform = `translate(${x}px, ${y}px)`;
    zoomInput.value = String(zoom);
  }

  // ----- dragging and pinching -----
  const pointers = new Map();
  let last = null;

  function gesture() {
    const pts = [...pointers.values()];
    const midX = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const midY = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { midX, midY, dist };
  }

  function onDown(e) {
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = gesture();
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = gesture();
    const s = coverScale() * zoom;
    if (!(s > 0)) return;
    cx -= (now.midX - last.midX) / (s * iw);
    cy -= (now.midY - last.midY) / (s * ih);
    if (now.dist && last.dist) {
      zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * (now.dist / last.dist)));
    }
    last = now;
    render();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    last = pointers.size ? gesture() : null;
  }

  function onWheel(e) {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    render();
  }

  function onZoomInput() {
    zoom = Number(zoomInput.value);
    render();
  }

  frame.addEventListener("pointerdown", onDown);
  frame.addEventListener("pointermove", onMove);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);
  frame.addEventListener("wheel", onWheel, { passive: false });
  zoomInput.addEventListener("input", onZoomInput);
  // Redraw whenever the frame changes size (opening, rotating the phone, resizing the window).
  const resized = new ResizeObserver(render);
  resized.observe(frame);
  zoomInput.max = String(MAX_ZOOM);
  render();

  const choice = await new Promise((resolve) => {
    $("#crop-use").onclick = () => resolve("use");
    $("#crop-cancel").onclick = () => resolve("cancel");
    $("#crop-reset").onclick = () => { zoom = 1; cx = 0.5; cy = 0.5; render(); };
    dialog.oncancel = (e) => { e.preventDefault(); resolve("cancel"); };
  });

  // Measure the crop while the window is still open (a closed window has no size).
  clamp();
  const s = coverScale() * zoom;
  const { fw, fh } = frameSize();
  const sw = fw / s;
  const sh = fh / s;
  const sx = cx * iw - sw / 2;
  const sy = cy * ih - sh / 2;

  frame.removeEventListener("pointerdown", onDown);
  frame.removeEventListener("pointermove", onMove);
  frame.removeEventListener("pointerup", onUp);
  frame.removeEventListener("pointercancel", onUp);
  frame.removeEventListener("wheel", onWheel);
  zoomInput.removeEventListener("input", onZoomInput);
  resized.disconnect();
  dialog.close();
  URL.revokeObjectURL(url);
  img.removeAttribute("src");

  if (choice !== "use") return null;
  if (!(sw > 0 && sh > 0)) throw new Error("the crop box had no size — please try again");

  // Cut out exactly what was inside the frame.
  const out = document.createElement("canvas");
  out.width = OUTPUT_WIDTH;
  out.height = Math.round(OUTPUT_WIDTH / FRAME_RATIO);
  out.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return { cropped: await toBlob(out, 0.88), original };
}
