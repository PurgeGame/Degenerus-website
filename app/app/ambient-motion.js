// Decorative loops should only consume frames while their artwork is visible.
// Keep actual draw/reveal animations under their owning component's control.
const SELECTOR = [
  'quest-objective-indicator',
  'boon-product-indicator',
  '.deg-referral-card__coin',
  '.replay-flame',
  '.replay-controls > .replay-reveal-btn',
  '.replay-controls > .ldj-results-cta',
].join(',');

export function mountAmbientMotion(root = globalThis.document) {
  if (!root?.body || typeof IntersectionObserver !== 'function'
    || typeof MutationObserver !== 'function') return () => {};
  const tracked = new Map();
  const paint = (element, visible) => {
    const paused = !visible || root.visibilityState === 'hidden';
    if (element.hasAttribute('data-ambient-paused') !== paused) {
      element.toggleAttribute('data-ambient-paused', paused);
    }
  };
  const observer = new IntersectionObserver((records) => {
    for (const { target, isIntersecting } of records) {
      if (!tracked.has(target)) continue;
      tracked.set(target, isIntersecting);
      paint(target, isIntersecting);
    }
  }, { rootMargin: '50px' });
  const visit = (node, fn) => {
    if (node.nodeType !== 1) return;
    if (node.matches(SELECTOR)) fn(node);
    node.querySelectorAll(SELECTOR).forEach(fn);
  };
  const add = (element) => {
    if (tracked.has(element)) return;
    tracked.set(element, false);
    paint(element, false);
    observer.observe(element);
  };
  visit(root.body, add);
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) visit(node, add);
      for (const node of record.removedNodes) visit(node, (element) => {
        if (element.isConnected || !tracked.has(element)) return;
        observer.unobserve(element);
        tracked.delete(element);
        element.removeAttribute('data-ambient-paused');
      });
    }
  });
  mutations.observe(root.body, { childList: true, subtree: true });
  const onVisibility = () => {
    for (const [element, visible] of tracked) paint(element, visible);
  };
  root.addEventListener('visibilitychange', onVisibility);
  return () => {
    observer.disconnect();
    mutations.disconnect();
    root.removeEventListener('visibilitychange', onVisibility);
    for (const element of tracked.keys()) element.removeAttribute('data-ambient-paused');
    tracked.clear();
  };
}
