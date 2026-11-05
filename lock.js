// Passcode screen. Keeps casual visitors out; it is not strong security, because the site's
// files are public on GitHub. The passcode itself is never stored: only a slow, salted hash
// (PBKDF2-SHA256), so it can't simply be read from the code.
// Once unlocked, this device stays unlocked until the passcode changes.

const LOCK = {
  salt: "itchyhandsvan.quote.v1",
  iterations: 200000,
  hash: "8a28beeb61f591ea6231f2fbef6c3b32c44bc707aab349b0b966696f81c4a1be", // PBKDF2 hash of the passcode (empty = no passcode)
};
const UNLOCK_KEY = "itchyquote.unlocked.v1";

async function hashPasscode(passcode) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(LOCK.salt), iterations: LOCK.iterations },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() {
  return !LOCK.hash || localStorage.getItem(UNLOCK_KEY) === LOCK.hash;
}

// Resolves once the right passcode has been entered on this device (immediately if already unlocked).
export function unlock() {
  const screen = document.getElementById("lock-screen");
  if (isUnlocked()) {
    document.documentElement.classList.remove("locked");
    screen.remove();
    return Promise.resolve();
  }

  const form = document.getElementById("lock-form");
  const input = document.getElementById("lock-input");
  const message = document.getElementById("lock-message");
  const button = form.querySelector("button");
  input.focus();

  return new Promise((resolve) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value) return;
      button.disabled = true;
      message.textContent = "";
      const ok = (await hashPasscode(input.value)) === LOCK.hash;
      button.disabled = false;
      if (!ok) {
        message.textContent = "That passcode isn't right.";
        input.value = "";
        form.classList.remove("shake");
        void form.offsetWidth; // restart the shake animation
        form.classList.add("shake");
        input.focus();
        return;
      }
      localStorage.setItem(UNLOCK_KEY, LOCK.hash);
      document.documentElement.classList.remove("locked");
      screen.remove();
      resolve();
    });
  });
}

// Settings → "Lock this device": forget the unlock so the passcode is asked for again.
export function lockDevice() {
  localStorage.removeItem(UNLOCK_KEY);
  location.reload();
}
