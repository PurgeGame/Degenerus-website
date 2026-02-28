# Testing Patterns

**Analysis Date:** 2026-02-28

## Test Framework

**Status:** No testing framework detected

- No test runner installed (jest, vitest, pytest not configured)
- No test files found in codebase (no `.test.js`, `.spec.js`, `.test.py`, `conftest.py`)
- No testing config files present (jest.config.js, vitest.config.ts, pytest.ini, tox.ini)

**Current State:**
- Codebase is not currently under test coverage
- Testing infrastructure would need to be established from scratch

## Existing Code Characteristics

Given the lack of formal testing, understanding test strategies for this codebase requires examining testability patterns:

**JavaScript Modules (Vanilla JS with IIFE pattern):**

Files like `/home/zak/Dev/PurgeGame/website/shared/nav.js` and `/home/zak/Dev/PurgeGame/website/beta/mint.js` use IIFE encapsulation:

```javascript
(function () {
  'use strict';

  // Private state
  var address = null;
  var provider = null;

  // Private functions
  function api(path, opts) { ... }
  function connectWallet() { ... }

  // Public interface
  window.initNav = function (config) { ... };
  window.openScoreInfo = function () { ... };
})();
```

**Challenge:** Encapsulated state and functions are not directly testable. Testing would require:
1. Refactoring to expose dependencies (dependency injection)
2. Breaking IIFE pattern or exposing internals for testing
3. Using module system (ESM or CommonJS) for proper imports

**Python Modules:**

`/home/zak/Dev/PurgeGame/website/event-indexer/event_indexer.py`:

```python
class EventIndexer:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.conn: Optional[sqlite3.Connection] = None

    async def init_db(self) -> None:
        ...

    async def start(self) -> None:
        ...
```

**Testability:** Better structure for testing. Class-based design allows:
- Mocking dependencies (config, sqlite3.Connection)
- Isolating async methods for unit testing
- Integration testing with test database

## Recommended Testing Approach

**For JavaScript (Vanilla IIFE modules):**

To add testing without major refactoring:

1. **Unit testing with module patterns:**
   - Create Jest/Vitest test files alongside source
   - Extract pure functions from IIFEs for testing
   - Test pure functions independently

2. **Example extracted function:**

```javascript
// src/shared/nav.js — extract pure helper
export function validateAffiliateCode(code) {
  return code && /^[A-Z0-9]{3,12}$/.test(code);
}
```

Test:
```javascript
// test/shared/nav.test.js
import { validateAffiliateCode } from '../../src/shared/nav';

describe('validateAffiliateCode', () => {
  it('accepts valid codes', () => {
    expect(validateAffiliateCode('ABC123')).toBe(true);
  });

  it('rejects short codes', () => {
    expect(validateAffiliateCode('AB')).toBe(false);
  });
});
```

3. **Integration testing for API interactions:**
   - Mock window.fetch
   - Test promise chains with async/await or done() callback
   - Verify DOM manipulation side effects

4. **Mocking Ethereum provider:**
   - Mock window.ethereum
   - Mock window.ethers (ethers v6 library)
   - Test wallet connection flows

**For Python:**

1. **Unit testing:**
   - Use pytest for async test support
   - Mock Web3 provider and sqlite3.Connection
   - Test EventIndexer class methods independently

2. **Example structure:**

```python
# tests/test_event_indexer.py
import pytest
from unittest.mock import Mock, AsyncMock, patch
from event_indexer import EventIndexer

@pytest.fixture
def mock_config():
    return {
        'rpc_http': 'http://localhost:8545',
        'db_path': ':memory:',
        'abi_dir': './abis',
    }

@pytest.mark.asyncio
async def test_init_db(mock_config):
    indexer = EventIndexer(mock_config)
    await indexer.init_db()
    assert indexer.conn is not None
```

3. **Mock Ethereum RPC:**
   - Use responses library to mock HTTP calls to Web3 provider
   - Test event decoding with sample log data

4. **Database testing:**
   - Use in-memory SQLite: `db_path: ':memory:'`
   - Seed test data for state reconstruction tests

## Test File Organization

**Recommended structure:**

```
/home/zak/Dev/PurgeGame/website/
├── shared/
│   ├── nav.js
│   └── nav.test.js         (co-located)
├── beta/
│   ├── mint.js
│   └── mint.test.js        (co-located)
├── event-indexer/
│   ├── event_indexer.py
│   └── __tests__/
│       ├── test_event_indexer.py
│       ├── test_sync.py
│       └── conftest.py
└── db/
    ├── export-jackpot-data.js
    └── export-jackpot-data.test.js
```

**Co-location pattern:** Test files in same directory as source (`*.test.js`)

## Test Data and Fixtures

**JavaScript:**

Fixtures for API mocking:

```javascript
// test/fixtures/wallet.js
export const mockWalletResponse = {
  player: {
    eth_address: '0x1234...',
    referral_code: 'ABC123',
    referral_locked: 1,
  }
};

export const mockNonceResponse = {
  message: 'Sign this message',
};
```

**Python:**

Fixtures via pytest:

```python
# tests/conftest.py
import pytest
from hexbytes import HexBytes

@pytest.fixture
def sample_event_log():
    return {
        'blockNumber': 12345,
        'transactionHash': HexBytes('0xabc...'),
        'logIndex': 0,
        'address': '0x...',
        'data': HexBytes('0x...'),
        'topics': [HexBytes('0x...')],
    }
```

**Location:**
- JavaScript: `test/fixtures/`
- Python: `tests/conftest.py` (pytest convention)

## Coverage Goals

**No coverage requirements currently enforced** — codebase has 0% coverage

**Recommended targets for new code:**
- Core logic functions: 80%+ coverage
- API integration: 70%+ (harder to test with HTTP mocks)
- Pure utilities: 100%

**Coverage tools:**
- JavaScript: Jest/Vitest built-in coverage
- Python: pytest-cov

```bash
# JavaScript
npm test -- --coverage

# Python
pytest --cov=event_indexer tests/
```

## Async Testing Patterns

**JavaScript (Promise-based):**

Current pattern in source:

```javascript
function connectWallet() {
  ethereum.request({ method: 'eth_requestAccounts' })
    .then(function (accounts) { ... })
    .catch(function (err) { console.warn(...) })
    .finally(function () { ... });
}
```

**Test approach:**

```javascript
// test/shared/nav.test.js
it('connects wallet on success', async () => {
  const mockRequest = jest.fn()
    .mockResolvedValueOnce(['0x123...']) // eth_requestAccounts
    .mockResolvedValueOnce('0xsig...');   // personal_sign

  window.ethereum = { request: mockRequest };

  await connectWallet();

  expect(mockRequest).toHaveBeenCalledWith({
    method: 'eth_requestAccounts'
  });
  expect(address).toBe('0x123...');
});
```

**Python (async/await):**

Current pattern in EventIndexer:

```python
async def subscribe_to_events(self) -> None:
    async with websockets.connect(self.rpc_ws) as ws:
        await ws.send(...)
        async for message in ws:
            ...
```

**Test approach:**

```python
@pytest.mark.asyncio
async def test_subscribe_to_events(mock_indexer):
    with patch('websockets.connect') as mock_ws:
        mock_ws.return_value.__aenter__.return_value = AsyncMock()
        # Simulate incoming events
        mock_ws.return_value.__aenter__.return_value.__aiter__.return_value = [
            json.dumps({"result": {...}})
        ]

        await mock_indexer.subscribe_to_events()
        # Assert events were processed
```

## What to Test

**High Priority (Core Logic):**
- Wallet connection/disconnection flows in `/home/zak/Dev/PurgeGame/website/shared/nav.js`
- Affiliate code validation and creation
- Mint/purchase flows in `/home/zak/Dev/PurgeGame/website/beta/mint.js`
- Event indexing and decoding in `/home/zak/Dev/PurgeGame/website/event-indexer/event_indexer.py`
- State reconstruction from events

**Medium Priority (Integration):**
- API calls to server (mock HTTP)
- localStorage behavior (sessions, referral codes)
- DOM updates and visibility toggles
- Database schema creation and querying

**Low Priority (Utilities):**
- JSON serialization helpers
- Address normalization functions
- BigInt arithmetic for wei conversions

## What NOT to Test

- External library behavior (window.ethers, window.ethereum)
- Third-party API responses (Ethereum RPC calls) — mock instead
- localStorage internals — mock localStorage
- Actual database operations on live chain — use test RPC + in-memory DB

## Configuration Recommendations

**Jest setup** (if JavaScript testing is added):

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  collectCoverageFrom: [
    'shared/**/*.js',
    'beta/**/*.js',
    'db/**/*.js',
    '!**/*.test.js'
  ],
  testMatch: ['**/*.test.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
```

**Pytest setup** (for Python):

```ini
# pytest.ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short
```

---

*Testing analysis: 2026-02-28*
