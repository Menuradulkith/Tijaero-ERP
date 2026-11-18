// Site motion: scroll reveal (with a small stagger) and cursor spotlights.
// Visual rules live in global.css under "motion"; this file only sets classes and positions.
// - Reduced motion: reveal still runs (CSS turns it into a plain show), cursor effects never start.
// - Touch / coarse pointers: cursor effects never start.
// - Only transform/opacity and custom properties change, batched to one write per animation frame.

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

/** Elements that get the soft cursor spotlight inside them. */
const SPOT = '.card, .mod, .flow-card, .plan, .chat, .sol-card, .biz-card, .why-card, .other';
/** Dark bands that get a large glow following the cursor. */
const GLOW = '.page-top, .dark';
/** Hero screenshots: tilt in 3D toward the cursor (strongest). */
const TILT_HERO = '.hero-shot, .p-shot';
/** Other product screenshots: a gentler tilt. Small crops inside cards are left alone. */
const TILT_SHOT = '.shot:not(.tile-shot)';

function initReveal() {
  const items = document.querySelectorAll<HTMLElement>('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      // Items entering in the same batch (e.g. a row of cards) are staggered 70ms apart, capped.
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        if (n) el.style.setProperty('--reveal-delay', `${Math.min(n, 5) * 70}ms`);
        el.classList.add('in');
        io.unobserve(el);
        n++;
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  items.forEach((el) => io.observe(el));
}

function initCursor() {
  if (reduce.matches || !finePointer.matches) return;
  document.documentElement.classList.add('cursor-fx');

  // One glow layer per dark band, moved with transform only (no repaint of the band).
  for (const band of document.querySelectorAll<HTMLElement>(GLOW)) {
    if (band.parentElement?.closest(GLOW)) continue; // nested dark surface: the outer glow covers it
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    band.prepend(glow);
  }

  let frame = 0;
  let last: PointerEvent | null = null;
  let spot: HTMLElement | null = null;
  let band: HTMLElement | null = null;
  let tilt: HTMLElement | null = null;

  const untilt = (el: HTMLElement) => {
    el.classList.remove('tilt-on');
    el.style.transform = ''; // the CSS transition eases it back flat
  };

  const paint = () => {
    frame = 0;
    if (!last) return;
    const target = last.target instanceof Element ? last.target : null;

    const nextSpot = target?.closest<HTMLElement>(SPOT) ?? null;
    if (nextSpot !== spot) {
      spot?.classList.remove('spot-on');
      nextSpot?.classList.add('spot-on');
      spot = nextSpot;
    }
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty('--mx', `${last.clientX - r.left}px`);
      spot.style.setProperty('--my', `${last.clientY - r.top}px`);
    }

    const nextBand = target?.closest<HTMLElement>(GLOW) ?? null;
    const outer = nextBand?.parentElement?.closest<HTMLElement>(GLOW) ?? nextBand;
    if (outer !== band) {
      band?.classList.remove('glow-on');
      outer?.classList.add('glow-on');
      band = outer;
    }
    if (band) {
      const r = band.getBoundingClientRect();
      const glow = band.querySelector<HTMLElement>(':scope > .cursor-glow');
      if (glow) glow.style.transform = `translate3d(${last.clientX - r.left}px, ${last.clientY - r.top}px, 0)`;
    }

    const nextTilt = target?.closest<HTMLElement>(TILT_HERO) ?? target?.closest<HTMLElement>(TILT_SHOT) ?? null;
    if (nextTilt !== tilt) {
      if (tilt) untilt(tilt);
      nextTilt?.classList.add('tilt-on');
      tilt = nextTilt;
    }
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const x = Math.min(Math.max((last.clientX - r.left) / r.width, 0), 1) - 0.5;
      const y = Math.min(Math.max((last.clientY - r.top) / r.height, 0), 1) - 0.5;
      const hero = tilt.matches(TILT_HERO);
      const max = hero ? 8 : 4; // degrees from edge to edge
      tilt.style.transform = `perspective(${hero ? 2200 : 1600}px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg)`;
      const shot = tilt.matches('.shot') ? tilt : tilt.querySelector<HTMLElement>('.shot');
      if (shot) {
        const s = shot.getBoundingClientRect();
        shot.style.setProperty('--gx', `${last.clientX - s.left}px`);
        shot.style.setProperty('--gy', `${last.clientY - s.top}px`);
      }
    }
  };

  const queue = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    last = e;
    if (!frame) frame = requestAnimationFrame(paint);
  };

  document.addEventListener('pointermove', queue, { passive: true });
  document.addEventListener('pointerleave', () => {
    spot?.classList.remove('spot-on');
    band?.classList.remove('glow-on');
    if (tilt) untilt(tilt);
    spot = band = tilt = null;
    last = null;
  });

  // If the user turns on reduced motion mid-visit, switch the cursor effects off.
  reduce.addEventListener('change', () => {
    if (reduce.matches) document.documentElement.classList.remove('cursor-fx');
  });
}

initReveal();
initCursor();
