// Crop window for product photos. The frame has the same shape as the photo box on the
// quotation (111 x 90), so what's inside the frame is exactly what the PDF shows.
// Drag to move, pinch or use the slider to zoom.

import { FRAME_RATIO, OUTPUT_WIDTH } from "./photos.js?v=32";

const ORIGINAL_MAX = 2400; // originals are scaled down to this to keep storage small
const MAX_ZOOM = 4;

const $ = (sel) => document.querySelector(sel);

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, ORIGINAL_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { canvas, blob: await toBlob(canvas, 0.9) };
}

/**
 * Opens the crop window for an image file/blob.
 * Resolves to { cropped, original } (JPEG Blobs), or null if cancelled.
 */
export async function cropPhoto(file, title) {
  const { canvas: source, blob: original } = await downscale(file);
  const dialog = $("#cropper");
  const frame = $("#crop-frame");
  const img = $("#crop-image");
  const zoomInput = $("#crop-zoom");
  $("#crop-title").textContent = title ? `Crop photo · ${title}` : "Crop photo";

  const url = URL.createObjectURL(original);
  const loaded = new Promise((resolve) => { img.onload = img.onerror = resolve; });
  img.src = url;
  dialog.showModal();
  await loaded;

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
  window.addEventListener("resize", render);
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
  window.removeEventListener("resize", render);
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
