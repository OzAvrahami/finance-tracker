const activeOverlays = [];

let bodyLockCount = 0;
let originalBodyOverflow = '';
let overlaySequence = 0;

export const registerOverlay = (id) => {
  activeOverlays.push(id);

  if (bodyLockCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;

  overlaySequence += 1;
  return 1000 + overlaySequence * 10;
};

export const unregisterOverlay = (id) => {
  const index = activeOverlays.lastIndexOf(id);
  if (index >= 0) activeOverlays.splice(index, 1);

  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
    originalBodyOverflow = '';
  }
};

export const isTopOverlay = (id) => activeOverlays.at(-1) === id;

