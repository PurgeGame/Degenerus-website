// Keep this bootstrap independent of the lesson's module graph. A stale or
// failed dependency must show a recoverable error, even before tutorial.js runs.
export function startTutorialLoader({ document, window, loadLesson = () => import('./tutorial.js?v=22') }) {
  const loading = document.querySelector('[data-bind="loading"]');
  const retry = document.querySelector('[data-bind="loading-retry"]');
  let timer;
  function fail(message) {
    clearTimeout(timer);
    loading.classList.remove('is-ready');
    loading.querySelector('strong').textContent = 'THE GAME COULD NOT LOAD';
    loading.querySelector('span').textContent = message || 'Something interrupted the game setup. Try loading it again.';
    retry.hidden = false;
  }
  function start() {
    clearTimeout(timer);
    loading.querySelector('strong').textContent = 'GETTING YOUR GAME READY';
    loading.querySelector('span').textContent = 'Two tickets. One jackpot. One flip.';
    retry.hidden = true;
    timer = setTimeout(() => fail('The game is taking too long to load. Try again.'), 30000);
  }
  window.addEventListener('degenerus:tutorial-loading', start);
  window.addEventListener('degenerus:tutorial-ready', () => {
    clearTimeout(timer);
    retry.hidden = true;
    loading.classList.add('is-ready');
  });
  window.addEventListener('degenerus:tutorial-error', event => fail(event.detail));
  retry.addEventListener('click', () => window.location.reload());
  start();
  return loadLesson().catch(error => {
    console.error('Unable to start the tutorial', error);
    fail('A game file could not load. Try again to get the latest version.');
  });
}

if (typeof document !== 'undefined') startTutorialLoader({ document, window });
