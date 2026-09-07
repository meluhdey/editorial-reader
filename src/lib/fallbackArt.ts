// Procedural cover art for articles with no usable header image.
//
// Every cover is a self-contained SVG data URI — no network request, nothing to
// hotlink-block, nothing to 404. `coverFor(seed)` is deterministic: the same
// article id always yields the same cover. `randomCover()` is for the shuffle
// button. Eight styles × eight palettes × randomised parameters.

// ── seeded RNG (xmur3 hash → mulberry32) ──────────────────────────────────

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private f: () => number;
  constructor(seed: string) {
    this.f = mulberry32(hashSeed(seed));
  }
  next(): number {
    return this.f();
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.f();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.f() * arr.length)];
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
}

// ── palettes: [ground, mid, deep] — muted, editorial ──────────────────────

const PALETTES: readonly (readonly [string, string, string])[] = [
  ['#F4F3ED', '#9A9A93', '#3D3D3A'], // paper & ink
  ['#EFE7DC', '#B58A63', '#6B4A32'], // clay
  ['#E7EBEF', '#8A9AB6', '#3C4A63'], // dusty blue
  ['#E8ECE4', '#8FA37F', '#47583F'], // sage
  ['#F1E9D6', '#C7A23A', '#856618'], // ochre
  ['#ECE6EF', '#A98FB8', '#5C4A6C'], // lilac
  ['#F1E3DA', '#C97B5A', '#7C4227'], // terracotta
  ['#EAEAE3', '#9C9C94', '#4A4A46'], // slate
];

const W = 1200;
const H = 900;

type Style = (r: Rng, pal: readonly [string, string, string]) => string;

const ground = (c: string) => `<rect width='${W}' height='${H}' fill='${c}'/>`;

const styleGradient: Style = (r, [g, m, d]) => {
  const ang = r.int(0, 359);
  const stops = r.chance(0.5)
    ? `<stop offset='0' stop-color='${g}'/><stop offset='1' stop-color='${m}'/>`
    : `<stop offset='0' stop-color='${m}'/><stop offset='0.5' stop-color='${g}'/><stop offset='1' stop-color='${d}'/>`;
  return `<defs><linearGradient id='g' gradientTransform='rotate(${ang} 0.5 0.5)'>${stops}</linearGradient></defs><rect width='${W}' height='${H}' fill='url(#g)'/>`;
};

const styleRadial: Style = (r, [g, m, d]) => {
  const cx = r.range(0.2, 0.8).toFixed(2);
  const cy = r.range(0.2, 0.8).toFixed(2);
  // mid at the focal point, deep at the edge — a glow, never a blown-out centre
  return `<defs><radialGradient id='r' cx='${cx}' cy='${cy}' r='0.95'><stop offset='0' stop-color='${g}'/><stop offset='0.35' stop-color='${m}'/><stop offset='1' stop-color='${d}'/></radialGradient></defs><rect width='${W}' height='${H}' fill='url(#r)'/>`;
};

const styleBauhaus: Style = (r, [g, m, d]) => {
  let s = ground(g);
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const col = r.chance(0.5) ? m : d;
    const op = r.range(0.55, 1).toFixed(2);
    const cx = r.int(0, W);
    const cy = r.int(0, H);
    const size = r.int(240, 560);
    const rot = r.int(0, 359);
    switch (r.pick(['circle', 'half', 'rect', 'tri'] as const)) {
      case 'circle':
        s += `<circle cx='${cx}' cy='${cy}' r='${(size / 2).toFixed(0)}' fill='${col}' opacity='${op}'/>`;
        break;
      case 'half':
        s += `<path d='M ${cx - size / 2} ${cy} A ${size / 2} ${size / 2} 0 0 1 ${cx + size / 2} ${cy} Z' fill='${col}' opacity='${op}' transform='rotate(${rot} ${cx} ${cy})'/>`;
        break;
      case 'rect':
        s += `<rect x='${cx - size / 2}' y='${cy - size / 2}' width='${size}' height='${r.int(180, size)}' fill='${col}' opacity='${op}' transform='rotate(${r.pick([0, 0, 15, -15, 45])} ${cx} ${cy})'/>`;
        break;
      default:
        s += `<path d='M ${cx} ${cy - size / 2} L ${cx + size / 2} ${cy + size / 2} L ${cx - size / 2} ${cy + size / 2} Z' fill='${col}' opacity='${op}' transform='rotate(${rot} ${cx} ${cy})'/>`;
    }
  }
  return s;
};

const styleArcs: Style = (r, [g, m, d]) => {
  const cx = r.pick([0, 0, W, W]);
  const cy = r.pick([0, H, 0, H]);
  let s = ground(g);
  const n = r.int(4, 8);
  const gap = r.int(120, 200);
  const sw = r.int(26, 70);
  for (let i = n; i >= 1; i--) {
    s += `<circle cx='${cx}' cy='${cy}' r='${i * gap}' fill='none' stroke='${i % 2 ? m : d}' stroke-width='${sw}' opacity='${(0.3 + 0.55 * (i / n)).toFixed(2)}'/>`;
  }
  return s;
};

const styleBands: Style = (r, [g, m, d]) => {
  const diag = r.chance(0.4);
  let s = ground(g);
  s += `<g${diag ? " transform='rotate(-20 600 450)'" : ''}>`;
  const y = diag ? -H / 2 : 0;
  const h = diag ? H * 2 : H;
  let x = diag ? -W / 2 : 0;
  const end = diag ? W * 1.5 : W;
  while (x < end) {
    const w = r.int(38, 150);
    if (r.chance(0.6)) {
      s += `<rect x='${x.toFixed(0)}' y='${y}' width='${w}' height='${h}' fill='${r.chance(0.5) ? m : d}' opacity='${r.range(0.22, 0.8).toFixed(2)}'/>`;
    }
    x += w;
  }
  return s + '</g>';
};

const styleDots: Style = (r, [g, m, d]) => {
  let s = ground(g);
  const step = r.int(120, 165);
  const fx = r.range(0.1, 0.9) * W;
  const fy = r.range(0.1, 0.9) * H;
  const col = r.chance(0.5) ? m : d;
  const maxD = Math.hypot(W, H);
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const dist = Math.hypot(x - fx, y - fy) / maxD;
      const rad = Math.max(1, (1 - dist) * step * 0.6 * r.range(0.7, 1.15));
      s += `<circle cx='${x.toFixed(0)}' cy='${y.toFixed(0)}' r='${rad.toFixed(0)}' fill='${col}'/>`;
    }
  }
  return s;
};

const styleContours: Style = (r, [g, m, d]) => {
  let s = ground(g);
  const n = r.int(5, 9);
  const seg = 6;
  const dx = (W + 100) / seg;
  for (let i = 0; i < n; i++) {
    const baseY = (i + 0.5) * (H / n) + r.range(-40, 40);
    const amp = r.range(28, 115);
    let d2 = `M -50 ${baseY.toFixed(0)}`;
    for (let k = 0; k < seg; k++) {
      const x0 = -50 + k * dx;
      const cx = x0 + dx / 2;
      const cy = baseY + (k % 2 === 0 ? amp : -amp);
      d2 += ` Q ${cx.toFixed(0)} ${cy.toFixed(0)} ${(x0 + dx).toFixed(0)} ${baseY.toFixed(0)}`;
    }
    s += `<path d='${d2}' fill='none' stroke='${i % 2 ? m : d}' stroke-width='${r.int(3, 7)}' opacity='${r.range(0.4, 0.9).toFixed(2)}'/>`;
  }
  return s;
};

const styleMesh: Style = (r, [g, m, d]) => {
  let s = `<defs><filter id='b' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='48'/></filter></defs>`;
  s += ground(g);
  s += "<g filter='url(#b)'>";
  const n = r.int(3, 5);
  for (let i = 0; i < n; i++) {
    // cycle through all three tones so blobs stay legible even on low-contrast palettes
    const col = [m, d, d, m, g][i % 5];
    s += `<ellipse cx='${r.int(120, W - 120)}' cy='${r.int(120, H - 120)}' rx='${r.int(240, 500)}' ry='${r.int(240, 500)}' fill='${col}' opacity='${r.range(0.5, 0.85).toFixed(2)}'/>`;
  }
  return s + '</g>';
};

const STYLES: readonly Style[] = [
  styleGradient,
  styleRadial,
  styleBauhaus,
  styleArcs,
  styleBands,
  styleDots,
  styleContours,
  styleMesh,
];

function buildSvg(seed: string): string {
  const r = new Rng(seed);
  const pal = r.pick(PALETTES);
  const inner = STYLES[r.int(0, STYLES.length - 1)](r, pal);
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'>${inner}</svg>`;
}

// Minimal data-URI encoding (attributes already use single quotes).
function toDataUri(svg: string): string {
  const body = svg
    .replace(/\s+/g, ' ')
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26')
    .trim();
  return `data:image/svg+xml,${body}`;
}

/** Deterministic cover for a stable seed (use the article id). */
export function coverFor(seed: string): string {
  return toDataUri(buildSvg(seed || 'untitled'));
}

/** A fresh random cover — for the "shuffle" control. */
export function randomCover(): string {
  return toDataUri(buildSvg(Math.random().toString(36).slice(2) + Date.now().toString(36)));
}

/** True for covers this module produced (vs. a scraped or classical-painting URL). */
export function isGeneratedCover(url: string | undefined): boolean {
  return !!url && url.startsWith('data:image/svg+xml,');
}
