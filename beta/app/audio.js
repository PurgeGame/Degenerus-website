// app/audio.js -- Minimal audio feedback for game events

const SOUND_FILES = {
  win: '/beta/sounds/win.mp3',
  flip: '/beta/sounds/flip.mp3',
  urgency: '/beta/sounds/urgency.mp3',
};

const sounds = {};
for (const [name, path] of Object.entries(SOUND_FILES)) {
  const s = new Audio(path);
  s.preload = 'auto';
  sounds[name] = s;
}

// Autoplay policy unlock: browsers block play() until user interaction
let unlocked = false;
function unlock() {
  if (unlocked) return;
  unlocked = true;
  for (const s of Object.values(sounds)) {
    s.play().then(() => s.pause()).catch(() => {});
    s.currentTime = 0;
  }
  document.removeEventListener('click', unlock, true);
  document.removeEventListener('keydown', unlock, true);
}
document.addEventListener('click', unlock, true);
document.addEventListener('keydown', unlock, true);

export function playSound(name) {
  const s = sounds[name];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => {});
}
