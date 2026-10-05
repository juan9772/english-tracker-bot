# Test Infrastructure Documentation (`TEST_INFRA.md`)

## 1. Overview & Architecture

The Telegram English Tracker Bot test infrastructure provides a fully offline, deterministic, opaque-box E2E test harness. The test architecture is structured across four distinct tiers adhering to the project pattern:

1. **Tier 1: Feature Coverage** (`test/tier1-features.test.js`): Comprehensive validation of all 21 features defined in `PROJECT.md` (>=5 test cases per feature, 105 tests).
2. **Tier 2: Boundary & Corner Cases** (`test/tier2-boundaries.test.js`): Rigorous boundary testing including extreme character lengths, 4096-character chunking thresholds, empty strings, unclosed/mismatched HTML tags, multi-day gap jumps (2, 3, 5, 10, 30 days), 0 shields, Monday resets, and invalid audio formats (105 tests).
3. **Tier 3: Cross-Feature Combinations** (`test/tier3-combinations.test.js`): Pairwise and multi-feature interaction testing (HTML chunking with inline keyboards, multi-day catchup with shield deduction & streak reset, voice note check-in with profile update and vocab extraction, public status with dynamic users).
4. **Tier 4: Real-World Scenarios** (`test/tier4-scenarios.test.js`): Complete end-to-end user workflows (Bro Juan streak 47 check-in via voice note, Sister Francy streak 18 check-in with complex formatting and bullets, web dashboard rendering `/api/status` data, multi-day absence recovery, evening reminder alert).

---

## 2. Directory Layout

```
telegram-english-bot/
├── test/
│   ├── helpers/
│   │   ├── mock-env.js         # Offline mocks: Redis KV, Telegram Bot API, Gemini Multimodal, Clock
│   │   └── adapter.js          # Authoritative reference stubs and contract adapter for all 21 features
│   ├── tier1-features.test.js   # Tier 1: 105 Feature coverage tests (21 features × 5 cases)
│   ├── tier2-boundaries.test.js # Tier 2: 105 Boundary & corner case tests (21 features × 5 cases)
│   ├── tier3-combinations.test.js # Tier 3: Pairwise & multi-feature combinatorial tests
│   ├── tier4-scenarios.test.js  # Tier 4: Real-world user scenario workflows
│   └── run-all-tests.js        # Master E2E test runner aggregating all tiers
├── scratch/
│   └── test-flow.js            # Legacy offline integration smoke flow
├── TEST_INFRA.md               # Test harness and infrastructure documentation (this file)
├── TEST_READY.md               # Test suite readiness publication report
└── package.json                # npm test script configuring unified test execution
```

---

## 3. Mocking & Isolation Strategy

To ensure 100% offline reproducibility and eliminate any external network dependencies or token expenditures during testing:

### 3.1 MockStorage (`test/helpers/mock-env.js`)
- In-memory deep-cloned state simulating Upstash Redis KV.
- Seeds production users `userA` (Juan, streak 47, shields 2, B2) and `userB` (Sister Francy, streak 18, shields 1, B1).
- Provides `getState()`, `saveState()`, and `reset()`.

### 3.2 MockTime (`test/helpers/mock-env.js`)
- High-precision virtual system clock replacing `globalThis.Date`.
- Provides deterministic time jumps via `advanceDays(n)`, `advanceHours(n)`, and `setTime(iso)`.
- Eliminates non-deterministic race conditions and timezone boundary shifts during multi-day testing.

### 3.3 MockNetwork (`test/helpers/mock-env.js`)
- Intercepts `globalThis.fetch` for:
  - **Telegram Bot API**: `sendMessage`, `answerCallbackQuery`, `getFile`, and binary audio downloads (`/file/bot...`).
  - **Google Gemini Multimodal API**: Simulates single-call AI evaluations returning structured JSON (transcription, pronunciation feedback, CEFR profile updates, and vocabulary flashcards).
  - **Failure Injection**: Configurable `telegramShouldFailStatus` and `geminiShouldFailStatus` (e.g. 503 Service Unavailable) to verify queueing and recovery.

### 3.4 Contract Adapter (`test/helpers/adapter.js`)
- Bridges the test suite with production modules when available (`api/_telegram.js`, `api/_queue.js`, `api/_db.js`, `api/cron.js`, `api/status.js`).
- Implements authoritative specification oracles for tag balancing, strict entity escaping, 4096-char chunking, multi-day catchup, and public status serialization according to `PROJECT.md`.

---

## 4. Execution Commands

### 4.1 Run Complete E2E Suite via npm
```bash
npm test
```
*Executes `test/run-all-tests.js` followed by `scratch/test-flow.js`.*

### 4.2 Run Master E2E Runner Directly
```bash
node test/run-all-tests.js
```

### 4.3 Run Individual Test Tiers
```bash
node test/tier1-features.test.js      # Run Tier 1 Feature tests
node test/tier2-boundaries.test.js    # Run Tier 2 Boundary tests
node test/tier3-combinations.test.js  # Run Tier 3 Combinations tests
node test/tier4-scenarios.test.js     # Run Tier 4 Scenario tests
```

---

## 5. Test Quality & Determinism Standards

1. **Opaque-Box Integrity**: Tests verify behavior and observable outputs against documented requirements, never private implementation quirks.
2. **Zero Network Calls**: All tests run 100% offline without hitting live Telegram or Gemini servers.
3. **Strict State Isolation**: Every test tier initializes a fresh mock environment, resetting state and uninstalling global clock/network hooks upon completion.
4. **Fast Execution**: Entire multi-tier suite executes in under 2 seconds.
