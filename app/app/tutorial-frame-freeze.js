(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tutorial') !== '1') return;

  const nativeSetInterval = window.setInterval;
  const nativeClearInterval = window.clearInterval;
  const intervalHandles = new Set();
  let frozen = false;

  // Let the production app construct and paint normally, but remember every
  // repeating job it starts. The parent tutorial freezes those jobs only after
  // the frame's load event, leaving a stable copy of the real UI to train on.
  window.setInterval = function (handler, delay, ...args) {
    const handle = nativeSetInterval.call(window, handler, delay, ...args);
    intervalHandles.add(handle);
    return handle;
  };

  window.clearInterval = function (handle) {
    intervalHandles.delete(handle);
    return nativeClearInterval.call(window, handle);
  };

  window.__DEGENERUS_TUTORIAL_FREEZE__ = Object.freeze({
    freeze() {
      if (frozen) return;
      frozen = true;
      for (const handle of intervalHandles) nativeClearInterval.call(window, handle);
      intervalHandles.clear();
      window.setInterval = nativeSetInterval;
      window.clearInterval = nativeClearInterval;
    },
  });
}());
