// Sound effects for Rat Race Royale, synthesized live with the Web Audio API (no audio files, nothing copyrighted).
// Every sound runs through a small mixing chain: instrument → (dry + soft reverb) → compressor → speakers,
// so effects sound full and glossy instead of beepy, and never clip.
let ctx = null, bus = null, verb = null;
let muted = (() => { try { return localStorage.getItem("cf.muted") === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function toggleMute() { muted = !muted; try { localStorage.setItem("cf.muted", muted ? "1" : "0"); } catch {} return muted; }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    const master = ctx.createGain(); master.gain.value = 0.9;
    comp.connect(master).connect(ctx.destination);
    bus = ctx.createGain(); bus.connect(comp);
    // soft room reverb from a generated impulse response
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    verb.connect(wet).connect(comp);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
const out = (node, wet = true) => { node.connect(bus); if (wet) node.connect(verb); };

/** A voice with an envelope. type: sine | triangle | square | sawtooth; filter = lowpass cutoff (Hz). */
function voice(freq, at = 0, dur = 0.2, { type = "sine", vol = 0.2, attack = 0.005, slideTo = null, filter = null, detune = 0, wet = true } = {}) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o.connect(g);
  if (filter) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filter; f.Q.value = 0.7; node = g.connect(f); }
  out(node, wet);
  o.start(t); o.stop(t + dur + 0.05);
}
/** Bell / chime: a few inharmonic partials that ring out. */
function bell(freq, at = 0, vol = 0.14, dur = 1.1) {
  [[1, 1], [2.01, 0.45], [2.76, 0.28], [5.4, 0.12]].forEach(([m, v]) => voice(freq * m, at, dur / (m * 0.6 + 0.4), { type: "sine", vol: vol * v, attack: 0.002 }));
}
/** Warm synth pad chord (detuned saws through a lowpass). */
function pad(freqs, at = 0, dur = 0.6, vol = 0.05) {
  freqs.forEach((f) => { voice(f, at, dur, { type: "sawtooth", vol, attack: 0.03, filter: 2200, detune: -7 }); voice(f, at, dur, { type: "sawtooth", vol, attack: 0.03, filter: 2200, detune: 7 }); });
}
/** Filtered noise burst (dice clatter, paper, register drawer). */
function noise(at = 0, dur = 0.05, vol = 0.25, freq = 2500, q = 1.2, type = "bandpass") {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  src.buffer = buf; out(src.connect(f).connect(g)); src.start(t);
}
/** Little percussive knock (wood / table). */
const knock = (at = 0, freq = 180, vol = 0.25) => voice(freq, at, 0.09, { type: "sine", vol, attack: 0.001, slideTo: freq * 0.55, wet: false });

const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, A6: 1760, C7: 2093 };

export const sfx = {
  click: () => { voice(1400, 0, 0.04, { type: "triangle", vol: 0.06, wet: false }); },
  dice: () => {
    // a handful of dice tumbling across a table, then settling
    const hits = [0, 0.06, 0.11, 0.19, 0.24, 0.33, 0.41, 0.52];
    hits.forEach((t, i) => { noise(t, 0.035, 0.32 - i * 0.025, 1800 + Math.random() * 2600, 3); knock(t, 140 + Math.random() * 120, 0.12); });
    knock(0.62, 120, 0.2);
  },
  step: () => { voice(N.A5, 0, 0.06, { type: "triangle", vol: 0.05, wet: false }); knock(0, 420, 0.05); },
  payday: () => { // cash register: drawer slide, two bright chimes, coin shimmer
    noise(0, 0.12, 0.18, 900, 0.8, "lowpass");
    bell(N.E6, 0.06, 0.13); bell(N.A6, 0.16, 0.12);
    for (let i = 0; i < 5; i++) voice(N.C7 + i * 180, 0.24 + i * 0.035, 0.12, { type: "triangle", vol: 0.04 });
  },
  coins: () => { [N.G6, N.C7, N.E6 * 2].forEach((f, i) => bell(f, i * 0.07, 0.07, 0.5)); },
  buy: () => { // rising major arpeggio with a bell on top
    [N.C5, N.E5, N.G5].forEach((f, i) => voice(f, i * 0.07, 0.22, { type: "triangle", vol: 0.12 }));
    bell(N.C6, 0.21, 0.12, 0.9); pad([N.C4, N.G4], 0.2, 0.5, 0.025);
  },
  sell: () => { bell(N.G5, 0, 0.1, 0.6); bell(N.C6, 0.08, 0.1, 0.8); noise(0.05, 0.1, 0.08, 6000, 0.7, "highpass"); },
  spend: () => { voice(N.E5, 0, 0.32, { type: "sawtooth", vol: 0.05, slideTo: 180, filter: 1800 }); noise(0, 0.08, 0.08, 700, 0.8, "lowpass"); },
  bills: () => { // paper shuffle + a soft descending "there it goes"
    noise(0, 0.09, 0.12, 3200, 0.6); noise(0.1, 0.08, 0.1, 2600, 0.6);
    [N.G5, N.E5, N.C5].forEach((f, i) => voice(f, 0.12 + i * 0.09, 0.18, { type: "triangle", vol: 0.07 }));
  },
  baby: () => { [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(f, i * 0.12, 0.07, 0.9)); },
  alarm: () => { for (let i = 0; i < 3; i++) { voice(N.A5, i * 0.26, 0.12, { type: "square", vol: 0.045, filter: 2500 }); voice(N.E5, i * 0.26 + 0.13, 0.12, { type: "square", vol: 0.045, filter: 2500 }); } },
  news: () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => bell(f, i * 0.1, 0.07, 0.7)); },
  hired: () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => voice(f, i * 0.08, 0.2, { type: "triangle", vol: 0.11 })); pad([N.C4, N.E4, N.G4], 0.3, 0.7, 0.025); bell(N.E6, 0.34, 0.09); },
  heart: () => { bell(N.E5, 0, 0.1, 0.9); bell(N.A5, 0.15, 0.1, 1.1); },
  error: () => { voice(196, 0, 0.16, { type: "square", vol: 0.04, filter: 900, slideTo: 150, wet: false }); },
  refund: () => { sfx.payday(); [N.C6, N.E6, N.G6].forEach((f, i) => bell(f, 0.45 + i * 0.08, 0.06, 0.8)); },
  badge: () => { [N.G5, N.C6, N.E6, N.G6].forEach((f, i) => bell(f, i * 0.06, 0.06, 0.6)); },
  win: () => { // fanfare: three chords then a sparkle
    pad([N.C4, N.E4, N.G4, N.C5], 0, 0.3, 0.05);
    pad([N.C4, N.F5 / 2, N.A4, N.C5], 0.32, 0.3, 0.05);
    pad([N.E4, N.G4, N.C5, N.E5], 0.64, 1.2, 0.06);
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => voice(f, 0.64 + i * 0.06, 0.5, { type: "triangle", vol: 0.09 }));
    for (let i = 0; i < 8; i++) bell(N.C6 * (1 + i * 0.125), 1.0 + i * 0.05, 0.04, 0.6);
  },
};

/** Map a log entry to a sound. */
export function soundFor(entry) {
  const k = entry.key;
  if (k === "roll") return sfx.dice;
  if (k === "payday" || k === "cashflow_day" || k === "raise") return sfx.payday;
  if (k === "bills") return sfx.bills;
  if (k === "payday_neg" || k === "spending" || k === "tax_bill") return sfx.spend;
  if (k === "tax_refund") return sfx.refund;
  if (k === "bought" || k === "bought_stock") return sfx.buy;
  if (k === "sold" || k === "payoff" || k === "repay") return sfx.sell;
  if (k === "baby") return sfx.baby;
  if (k === "downsized" || k === "lawsuit" || k === "audit" || k === "fast_crash") return sfx.alarm;
  if (k === "econ" || k === "share_offer") return sfx.news;
  if (k === "hired") return sfx.hired;
  if (k === "charity_yes" || k === "charity_offer") return sfx.heart;
  if (k === "loan") return sfx.coins;
  if (k === "badge") return sfx.badge;
  if (k === "win" || k === "dream_win" || k === "fast_win" || k === "escaped") return sfx.win;
  return null;
}
