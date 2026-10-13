// Only this same-origin frame can resize its place in the paper.
const frame = document.getElementById('theory-game-frame');
window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin
    || event.data?.type !== 'theory-widget-height') return;
  const height = Number(event.data.height);
  if (Number.isFinite(height)) frame.height = String(Math.ceil(Math.max(360, Math.min(2400, height))));
});
