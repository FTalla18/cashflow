// Visual juice: confetti bursts and floating +$/−$ amounts. Purely cosmetic (never touches game state).
const layer = () => document.getElementById("fx");
const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Confetti burst from the top-center (or from x,y as fractions of the screen). */
export function confetti({ x = 0.5, y = 0.35, count = 140, colors = ["#2f7bff", "#22d3ee", "#2ee59d", "#ffd23f", "#ff5fa2", "#ffffff"] } = {}) {
  if (reduced()) return;
  const host = layer(); if (!host) return;
  const c = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  host.appendChild(c);
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth * x, y: innerHeight * y,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    color: colors[(Math.random() * colors.length) | 0], life: 0,
  }));
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 2600);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

/** "+$1,234" floating up from an element (or the screen center). */
export function floatMoney(text, positive, anchor) {
  if (reduced()) return;
  const host = layer(); if (!host) return;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
  const el = document.createElement("div");
  el.className = `float ${positive ? "pos" : "neg"}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top - 10}px`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
