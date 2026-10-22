// Sound effects, synthesized live with the Web Audio API (no audio files, nothing copyrighted).
let ctx = null;
let muted = (() => { try { return localStorage.getItem("cf.muted") === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function toggleMute() { muted = !muted; try { localStorage.setItem("cf.muted", muted ? "1" : "0"); } catch {} return muted; }

function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** one tone: frequency (Hz), start offset (s), duration (s), wave type, volume */
function tone(freq, at = 0, dur = 0.12, type = "sine", vol = 0.18, slideTo = null) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

/** short burst of filtered noise (dice clatter) */
function noise(at = 0, dur = 0.05, vol = 0.25, freq = 2500) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass"; f.frequency.value = freq; g.gain.value = vol;
  src.buffer = buf; src.connect(f).connect(g).connect(c.destination); src.start(t);
}

export const sfx = {
  click: () => tone(660, 0, 0.05, "triangle", 0.08),
  dice: () => { for (let i = 0; i < 6; i++) noise(i * 0.07, 0.05, 0.3, 1800 + i * 300); tone(220, 0.42, 0.08, "square", 0.05); },
  step: () => tone(880, 0, 0.04, "triangle", 0.06),
  payday: () => { tone(1318, 0, 0.09, "square", 0.08); tone(1760, 0.08, 0.22, "square", 0.08); noise(0.02, 0.12, 0.12, 6000); }, // cha-ching
  coins: () => { [1568, 1976, 2349].forEach((f, i) => tone(f, i * 0.06, 0.12, "triangle", 0.1)); },
  buy: () => { tone(523, 0, 0.1, "triangle", 0.14); tone(659, 0.08, 0.1, "triangle", 0.14); tone(784, 0.16, 0.18, "triangle", 0.14); },
  sell: () => { tone(784, 0, 0.08, "square", 0.07); tone(1046, 0.07, 0.16, "square", 0.07); noise(0.05, 0.1, 0.1, 6000); },
  spend: () => tone(520, 0, 0.35, "sawtooth", 0.07, 180),
  baby: () => { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, i * 0.11, 0.25, "sine", 0.1)); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone(880, i * 0.28, 0.13, "square", 0.08); tone(660, i * 0.28 + 0.14, 0.13, "square", 0.08); } },
  news: () => { tone(392, 0, 0.12, "triangle", 0.12); tone(523, 0.12, 0.12, "triangle", 0.12); tone(784, 0.24, 0.25, "triangle", 0.12); },
  hired: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle", 0.12)); },
  heart: () => { tone(660, 0, 0.18, "sine", 0.12); tone(880, 0.15, 0.3, "sine", 0.12); },
  error: () => tone(220, 0, 0.18, "square", 0.06, 160),
  win: () => { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.13, i === 6 ? 0.7 : 0.16, "square", 0.08)); noise(0.9, 0.3, 0.08, 5000); },
};

/** Map a log entry to a sound. */
export function soundFor(entry) {
  const k = entry.key;
  if (k === "roll") return sfx.dice;
  if (k === "payday") return sfx.payday;
  if (k === "payday_neg" || k === "spending") return sfx.spend;
  if (k === "bought" || k === "bought_stock") return sfx.buy;
  if (k === "sold" || k === "payoff" || k === "repay") return sfx.sell;
  if (k === "baby") return sfx.baby;
  if (k === "downsized") return sfx.alarm;
  if (k === "econ") return sfx.news;
  if (k === "hired") return sfx.hired;
  if (k === "charity_yes" || k === "charity_offer") return sfx.heart;
  if (k === "loan") return sfx.coins;
  if (k === "win") return sfx.win;
  return null;
}
