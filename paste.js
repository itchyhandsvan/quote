// Paste window for product photos: copy a photo in Photos (Share → Copy), then tap and hold
// the box and choose Paste. This skips the Photo Library picker, which gets stuck on some iPhones.
// It uses a normal paste into the page, because Safari's clipboard reading doesn't return
// photos copied from the Photos app.

const $ = (sel) => document.querySelector(sel);

// Finds the image in a paste: as a file (iPhone, Mac), or as an <img> in pasted HTML.
async function imageFrom(data) {
  if (!data) return null;
  const file = [...data.files].find((f) => f.type.startsWith("image/"))
    || [...data.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).find(Boolean);
  if (file) return file;
  const src = /<img[^>]+src="((?:data:image|blob:)[^"]+)"/i.exec(data.getData("text/html") || "")?.[1];
  if (src) {
    try { return await (await fetch(src)).blob(); } catch { /* fall through */ }
  }
  return null;
}

/** Opens the paste window. Resolves to the pasted image (File/Blob), or null if cancelled. */
export function pastePhoto(title) {
  const dialog = $("#paste-dialog");
  const box = $("#paste-box");
  const message = $("#paste-message");
  $("#paste-title").textContent = title ? `Paste photo · ${title}` : "Paste photo";
  message.hidden = true;
  box.replaceChildren();
  dialog.showModal();
  box.focus();

  return new Promise((resolve) => {
    const finish = (image) => {
      box.onpaste = box.onbeforeinput = null;
      dialog.close();
      resolve(image);
    };
    // The box only takes pastes; nothing can be typed into it.
    box.onbeforeinput = (e) => e.preventDefault();
    box.onpaste = async (e) => {
      e.preventDefault();
      const image = await imageFrom(e.clipboardData);
      if (image) return finish(image);
      const types = [...(e.clipboardData?.types || [])].join(", ") || "nothing";
      message.textContent = `That wasn't a photo (the clipboard had: ${types}). In Photos, open the photo, tap Share → Copy, then paste here again.`;
      message.hidden = false;
    };
    $("#paste-cancel").onclick = () => finish(null);
    dialog.oncancel = (e) => { e.preventDefault(); finish(null); };
  });
}
