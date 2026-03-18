// app/events.js -- EventTarget-based pub/sub bus

const bus = new EventTarget();

export function emit(type, detail = {}) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, handler) {
  const wrapped = (e) => handler(e.detail);
  bus.addEventListener(type, wrapped);
  return () => bus.removeEventListener(type, wrapped);
}

export function off(type, handler) {
  bus.removeEventListener(type, handler);
}
