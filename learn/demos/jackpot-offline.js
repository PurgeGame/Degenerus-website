// Offline stand-in for /app/chain/router.js, mapped in by jackpot.js through the
// page's import map. The demo feeds the replay panel a canned draw through its
// tutorial-fixture hook; the panel's own startup read (the day list) must not
// reach an RPC node. An AbortError is the panel's "expected cancellation" path:
// it stays silent and keeps the fixture's board.
export async function readChainRoute() {
  const error = new Error('Offline demo: no chain reads');
  error.name = 'AbortError';
  throw error;
}
