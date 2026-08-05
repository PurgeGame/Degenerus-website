// viewer/scrubber.js -- Day slider, prev/next, jump input with debounce and response versioning
// NAV-02: slider navigation, 150ms debounce on input, response versioning to discard stale fetches
//
// Exports:
//   createScrubber({ root, idPrefix, minDay, maxDay, initialDay, onDayChange })
//     → { setRange, setDay, getDay, dispose }   (Plan 03 factory API)
//   initScrubber(config)     — legacy wrapper for viewer.html (backward compat)
//   loadDays(playerAddr)     — viewer-only: fetches player's available days
//   setDay(day)              — viewer-only: updates module-level instance
//   getCurrentDay()          — viewer-only
//   getDaysData()            — viewer-only

import { fetchJSON } from './api.js';

// ---------------------------------------------------------------------------
// Factory: createScrubber — creates a self-contained, closured scrubber
// instance that injects its own HTML scaffold into `root`.
// ---------------------------------------------------------------------------

export function createScrubber({
  root,
  idPrefix = 'viewer',
  minDay: initMin = 1,
  maxDay: initMax = 1,
  initialDay = 1,
  onDayChange = null,
}) {
  // Per-instance state (closure — no module-level mutation)
  let minDay = initMin;
  let maxDay = initMax;
  let currentDay = Math.max(initMin, Math.min(initMax, initialDay));
  let debounceTimer = null;
  let requestVersion = 0;

  // Inject DOM scaffold into root
  root.innerHTML = `
    <div class="viewer-scrubber" id="${idPrefix}-scrubber" style="opacity:0.4;pointer-events:none">
      <button class="btn-icon" id="${idPrefix}-prev" aria-label="Previous day" disabled>&#8249;</button>
      <div class="viewer-scrubber__track">
        <input type="range" id="${idPrefix}-slider" min="${minDay}" max="${maxDay}" value="${currentDay}" aria-label="Day selector">
      </div>
      <button class="btn-icon" id="${idPrefix}-next" aria-label="Next day" disabled>&#8250;</button>
      <span class="viewer-scrubber__day-label" id="${idPrefix}-label">Day ${currentDay} of ${maxDay}</span>
      <input type="number" id="${idPrefix}-jump" class="viewer-scrubber__jump" min="${minDay}" max="${maxDay}" placeholder="42">
      <button class="btn-ghost btn-small" id="${idPrefix}-go">Go</button>
    </div>
  `;

  // Resolve elements scoped to root
  const scrubberEl = root.querySelector(`#${idPrefix}-scrubber`);
  const sliderEl   = root.querySelector(`#${idPrefix}-slider`);
  const prevEl     = root.querySelector(`#${idPrefix}-prev`);
  const nextEl     = root.querySelector(`#${idPrefix}-next`);
  const labelEl    = root.querySelector(`#${idPrefix}-label`);
  const jumpEl     = root.querySelector(`#${idPrefix}-jump`);
  const goEl       = root.querySelector(`#${idPrefix}-go`);

  // --- Internal helpers ---

  function updateLabel(day) {
    labelEl.textContent = `Day ${day} of ${maxDay}`;
  }

  function updateButtonStates() {
    prevEl.disabled = currentDay <= minDay;
    nextEl.disabled = currentDay >= maxDay;
  }

  function enableScrubber() {
    scrubberEl.style.opacity = '1';
    scrubberEl.style.pointerEvents = 'auto';
  }

  function navigateToDay(day) {
    currentDay = day;
    sliderEl.value = String(day);
    updateLabel(day);
    updateButtonStates();
    if (onDayChange) onDayChange(day);
  }

  function jumpToDay() {
    const val = parseInt(jumpEl.value, 10);
    if (isNaN(val)) return;
    const clamped = Math.max(minDay, Math.min(maxDay, val));
    navigateToDay(clamped);
  }

  // --- Wire events ---

  function onSliderInput() {
    const day = Number(sliderEl.value);
    updateLabel(day);
    clearTimeout(debounceTimer);
    // Request versioning: bump version so any in-flight callback from a prior
    // input event can detect it's stale (NAV-02 / Pitfall 5 pattern).
    requestVersion++;
    debounceTimer = setTimeout(() => navigateToDay(day), 150);
  }

  function onPrevClick() {
    if (currentDay > minDay) navigateToDay(currentDay - 1);
  }

  function onNextClick() {
    if (currentDay < maxDay) navigateToDay(currentDay + 1);
  }

  function onGoClick() {
    jumpToDay();
  }

  function onJumpKeydown(e) {
    if (e.key === 'Enter') jumpToDay();
  }

  sliderEl.addEventListener('input', onSliderInput);
  prevEl.addEventListener('click', onPrevClick);
  nextEl.addEventListener('click', onNextClick);
  goEl.addEventListener('click', onGoClick);
  jumpEl.addEventListener('keydown', onJumpKeydown);

  // --- Public API ---

  function setRange(min, max) {
    minDay = min;
    maxDay = max;
    sliderEl.min = String(min);
    sliderEl.max = String(max);
    jumpEl.min = String(min);
    jumpEl.max = String(max);
    updateLabel(currentDay);
    updateButtonStates();
    enableScrubber();
  }

  function setDay(day) {
    const clamped = Math.max(minDay, Math.min(maxDay, day));
    currentDay = clamped;
    sliderEl.value = String(clamped);
    updateLabel(clamped);
    updateButtonStates();
  }

  function getDay() {
    return currentDay;
  }

  function dispose() {
    clearTimeout(debounceTimer);
    sliderEl.removeEventListener('input', onSliderInput);
    prevEl.removeEventListener('click', onPrevClick);
    nextEl.removeEventListener('click', onNextClick);
    goEl.removeEventListener('click', onGoClick);
    jumpEl.removeEventListener('keydown', onJumpKeydown);
  }

  return { setRange, setDay, getDay, dispose };
}

// ---------------------------------------------------------------------------
// Legacy module-level state — used by the viewer-only exported functions
// (initScrubber, loadDays, setDay, getCurrentDay, getDaysData).
// These are NOT used by jackpot-panel; they remain for backward compat with
// viewer/main.js which imports them directly.
// ---------------------------------------------------------------------------

let _viewerInstance = null;

// Module-level viewer-only state (for loadDays / getDaysData)
let _minDay = 1;
let _maxDay = 1;
let _currentPlayer = null;
let _requestVersion = 0;
let _daysData = null;

// Elements still referenced by the viewer page's static DOM
let _sliderEl, _prevEl, _nextEl, _labelEl, _jumpEl, _goEl, _scrubberEl;

export function initScrubber(config) {
  // viewer.html has a pre-existing static scrubber DOM (id="viewer-scrubber", etc.)
  // We cannot inject a scaffold here because the elements already exist in the HTML.
  // Resolve elements from the existing static DOM.
  _sliderEl   = document.getElementById('viewer-day-slider');
  _prevEl     = document.getElementById('viewer-prev');
  _nextEl     = document.getElementById('viewer-next');
  _labelEl    = document.getElementById('viewer-day-label');
  _jumpEl     = document.getElementById('viewer-day-jump');
  _goEl       = document.getElementById('viewer-day-go');
  _scrubberEl = document.getElementById('viewer-scrubber');

  const _onDayChange = config.onDayChange;

  // Slider input with 150ms debounce (per D-15, Pitfall 5)
  _sliderEl.addEventListener('input', () => {
    const day = Number(_sliderEl.value);
    _updateLabel(day);
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _navigateToDay(day, _onDayChange), 150);
  });

  // Prev/next buttons (per D-16)
  _prevEl.addEventListener('click', () => {
    if (_currentDay > _minDay) _navigateToDay(_currentDay - 1, _onDayChange);
  });
  _nextEl.addEventListener('click', () => {
    if (_currentDay < _maxDay) _navigateToDay(_currentDay + 1, _onDayChange);
  });

  // Jump-to-day (per D-13)
  _goEl.addEventListener('click', () => _jumpToDay(_onDayChange));
  _jumpEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _jumpToDay(_onDayChange);
  });
}

let _currentDay = 1;
let _debounceTimer = null;

function _navigateToDay(day, onDayChange) {
  _currentDay = day;
  _sliderEl.value = String(day);
  _updateLabel(day);
  _updateButtonStates();
  if (onDayChange) onDayChange(day);
}

function _updateLabel(day) {
  _labelEl.textContent = `Day ${day} of ${_maxDay}`;
}

function _updateButtonStates() {
  _prevEl.disabled = _currentDay <= _minDay;
  _nextEl.disabled = _currentDay >= _maxDay;
}

function _enableScrubber() {
  _scrubberEl.style.opacity = '1';
  _scrubberEl.style.pointerEvents = 'auto';
}

function _disableScrubber() {
  _scrubberEl.style.opacity = '0.4';
  _scrubberEl.style.pointerEvents = 'none';
}

function _jumpToDay(onDayChange) {
  const val = parseInt(_jumpEl.value, 10);
  if (isNaN(val)) return;
  const clamped = Math.max(_minDay, Math.min(_maxDay, val));
  _navigateToDay(clamped, onDayChange);
}

export async function loadDays(playerAddr) {
  _currentPlayer = playerAddr;
  _disableScrubber();
  _labelEl.textContent = 'Loading...';

  // Response versioning: increment counter, discard stale responses (per D-15, Pitfall 5)
  const myVersion = ++_requestVersion;

  try {
    const data = await fetchJSON(`/viewer/player/${playerAddr}/days`);

    // Discard stale response if user changed player while fetch was in-flight
    if (myVersion !== _requestVersion) return null;

    _daysData = data.days;

    if (!_daysData || _daysData.length === 0) {
      _labelEl.textContent = 'No days found';
      return null;
    }

    _minDay = _daysData[0].day;
    _maxDay = _daysData[_daysData.length - 1].day;

    _sliderEl.min = String(_minDay);
    _sliderEl.max = String(_maxDay);
    _jumpEl.min = String(_minDay);
    _jumpEl.max = String(_maxDay);

    _enableScrubber();
    return { minDay: _minDay, maxDay: _maxDay };
  } catch (err) {
    // Discard stale error if user changed player while fetch was in-flight
    if (myVersion !== _requestVersion) return null;

    console.error('[viewer] Failed to load days:', err);
    _labelEl.textContent = 'Error loading days';
    const errorEl = document.createElement('div');
    errorEl.className = 'viewer-error';
    errorEl.textContent = 'Could not load days for this player. Try selecting again.';
    _scrubberEl.parentElement.appendChild(errorEl);
    return null;
  }
}

export function setDay(day) {
  const clamped = Math.max(_minDay, Math.min(_maxDay, day));
  _currentDay = clamped;
  _sliderEl.value = String(clamped);
  _updateLabel(clamped);
  _updateButtonStates();
}

export function getCurrentDay() {
  return _currentDay;
}

export function getDaysData() {
  return _daysData;
}
