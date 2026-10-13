// A separate bootstrap can report import failures before the game module runs.
const status = document.getElementById('widget-loading');
const retry = document.getElementById('widget-retry');
retry.addEventListener('click', () => location.reload());
const timer = setTimeout(() => {
  status.textContent = 'The jackpot is taking longer to load. You can try again.';
  retry.hidden = false;
}, 20000);

let lastHeight = 0;
function resize() {
  const height = Math.ceil(document.querySelector('.widget-shell').getBoundingClientRect().height);
  if (height === lastHeight) return;
  lastHeight = height;
  if (parent !== window) parent.postMessage({ type: 'theory-widget-height', height }, location.origin);
}
new ResizeObserver(resize).observe(document.querySelector('.widget-shell'));

try {
  await import('./widgets.js');
  status.hidden = true;
  retry.hidden = true;
} catch (error) {
  console.error('Unable to load jackpot example', error);
  status.hidden = false;
  status.textContent = 'The jackpot example could not load. Try again, or keep reading below.';
  retry.hidden = false;
} finally {
  clearTimeout(timer);
  resize();
}
