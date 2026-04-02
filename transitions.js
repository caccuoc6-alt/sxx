/**
 * Minimal global micro-interactions:
 * - Page fade-in / fade-out for same-tab navigation
 * - Simple ripple effect on buttons
 *
 * Performance notes:
 * - Uses opacity/transform only (GPU-friendly)
 * - Avoids layout thrashing
 */

function isInternalLink(a) {
  if (!a) return false;
  const href = a.getAttribute("href");
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  return true;
}

function setPageState(state) {
  document.documentElement.dataset.page = state;
}

// Fade in on load
window.addEventListener("DOMContentLoaded", () => {
  setPageState("ready");
});

// Fade out before navigating away (internal links)
document.addEventListener("click", (e) => {
  const a = e.target?.closest?.("a");
  if (!isInternalLink(a)) return;

  // Allow ctrl/cmd click to open in new tab.
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

  e.preventDefault();
  const href = a.getAttribute("href");
  setPageState("leaving");
  window.setTimeout(() => {
    window.location.href = href;
  }, 160);
});

// Ripple effect on clicks (buttons and button-like elements)
document.addEventListener("pointerdown", (e) => {
  const el = e.target?.closest?.(".btn, .socialBtn, .iconBtn");
  if (!el) return;
  if (el.classList.contains("iconBtn")) return; // keep tiny icon buttons clean

  const rect = el.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";

  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

  el.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

