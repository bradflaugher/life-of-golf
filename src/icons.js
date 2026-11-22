// Life of Golf — inline stroke icons (no emoji, no icon font).

const PATHS = {
  flag: '<path d="M7 21V4"/><path d="M7 4l11 4-11 4" fill="currentColor"/><ellipse cx="9" cy="21" rx="6" ry="1.4"/>',
  daily: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3v3H8z" fill="currentColor"/>',
  course: '<path d="M2.5 20L9 7.5l3.6 6.2 2.4-3.7L21.5 20z"/><path d="M7.2 11l1.8 1.6 1.8-1.4"/>',
  caddie: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2z"/>',
  sound: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  undo: '<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10a5.5 5.5 0 0 1 0 11H9"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M3.5 3.5v5h5"/>',
  next: '<path d="M5 5.5l6.5 6.5L5 18.5M12.5 5.5L19 12l-6.5 6.5"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 13v7h14v-7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.6.5.9 1.1.9 1.8h5.4c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.5z"/>',
  flame: '<path d="M12 21c-3.4 0-6-2.4-6-5.7 0-2.4 1.4-4 2.6-5.6C9.6 8.4 10.2 6.8 10 4c2.9 1.3 4.8 3.8 4.8 6.5.8-.4 1.4-1.1 1.7-2 1 1.4 1.5 3 1.5 4.8C18 18.6 15.4 21 12 21z"/>',
};

export function icon(name, cls = '') {
  const body = PATHS[name] || '';
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Fill every `[data-icon]` placeholder under `root` with its SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
