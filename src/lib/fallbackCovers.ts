// Cover images for articles (and books) with no usable art of their own:
// the original Unsplash paintings plus the gradient set in public/covers/gradients
// (web-sized copies of "Vibed Applications/Gradients": 1000px JPEG, q60).

const PAINTINGS = [
  'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578301978018-3005759f48f7?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1576016770956-debb63d900ee?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580136579312-94651dfd596d?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1605721911519-3dfeb3be25e7?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1584727638096-042c45049edd?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928621-7a13d66a62d1?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580136608260-4eb11f4b24fe?q=80&w=800&auto=format&fit=crop',
];

const GRADIENT_COUNT = 50;
export const GRADIENTS = Array.from({ length: GRADIENT_COUNT }, (_, i) => `/covers/gradients/gradient-${i + 1}.jpg`);

export const FALLBACK_COVERS = [...PAINTINGS, ...GRADIENTS];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

/** Stable pick for an id from paintings + gradients. */
export function fallbackCoverFor(id: string): string {
  return FALLBACK_COVERS[hash(id) % FALLBACK_COVERS.length];
}

/** Stable gradient-only pick (used behind generated book jackets). */
export function gradientFor(id: string): string {
  return GRADIENTS[hash(id) % GRADIENTS.length];
}

/** Random pick for the shuffle button, never the current one. */
export function randomFallbackCover(current?: string): string {
  const pool = FALLBACK_COVERS.filter((c) => c !== current);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Header images that should be treated as "no image": Wikimedia logos, and the
 * procedural SVG covers an earlier version stored when shuffling.
 */
export function isPlaceholderImage(url: string | undefined): boolean {
  return !url || url.includes('upload.wikimedia.org') || url.startsWith('data:image/svg+xml');
}
