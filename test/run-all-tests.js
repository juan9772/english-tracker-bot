// test/run-all-tests.js
/**
 * Master E2E Test Runner
 * Executes all test tiers (Tiers 1-4) cleanly and reports comprehensive execution summary.
 */

import { runTier1Tests } from './tier1-features.test.js';
import { runTier2Tests } from './tier2-boundaries.test.js';
import { runTier3Tests } from './tier3-combinations.test.js';
import { runTier4Tests } from './tier4-scenarios.test.js';
import { runTier5Tests } from './tier5-adversarial.test.js';

async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   TELEGRAM ENGLISH TRACKER BOT — E2E TEST SUITE RUNNER       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];
  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;

  const tiers = [
    { name: 'Tier 1: Feature Coverage (21 Features)', runner: runTier1Tests },
    { name: 'Tier 2: Boundary & Corner Cases (21 Features)', runner: runTier2Tests },
    { name: 'Tier 3: Pairwise & Multi-Feature Combos', runner: runTier3Tests },
    { name: 'Tier 4: End-to-End Real-World Scenarios', runner: runTier4Tests },
    { name: 'Tier 5: Adversarial Coverage Hardening', runner: runTier5Tests }
  ];

  for (const tier of tiers) {
    const tierStart = Date.now();
    try {
      const { passed, total } = await tier.runner();
      const durationMs = Date.now() - tierStart;
      const failed = total - passed;
      grandTotal += total;
      grandPassed += passed;
      grandFailed += failed;
      results.push({
        name: tier.name,
        total,
        passed,
        failed,
        durationMs,
        status: failed === 0 ? 'PASS' : 'FAIL'
      });
    } catch (err) {
      const durationMs = Date.now() - tierStart;
      results.push({
        name: tier.name,
        total: 1,
        passed: 0,
        failed: 1,
        durationMs,
        status: 'CRASH',
        error: err.message
      });
      grandFailed += 1;
      grandTotal += 1;
      console.error(`\n❌ Error running ${tier.name}:`, err);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n================================================================');
  console.log('                 E2E TEST SUITE EXECUTION SUMMARY');
  console.log('================================================================');
  console.log(
    '| Tier                                          | Tests | Pass | Fail | Time   | Status |'
  );
  console.log(
    '|-----------------------------------------------|-------|------|------|--------|--------|'
  );

  for (const r of results) {
    const paddedName = r.name.padEnd(45, ' ').slice(0, 45);
    const paddedTotal = String(r.total).padStart(5, ' ');
    const paddedPass = String(r.passed).padStart(4, ' ');
    const paddedFail = String(r.failed).padStart(4, ' ');
    const paddedTime = `${r.durationMs}ms`.padStart(6, ' ');
    const paddedStatus = (r.status === 'PASS' ? '✅ PASS' : '❌ FAIL').padEnd(6, ' ');
    console.log(`| ${paddedName} | ${paddedTotal} | ${paddedPass} | ${paddedFail} | ${paddedTime} | ${paddedStatus} |`);
  }

  console.log('----------------------------------------------------------------');
  console.log(`Total Tests Executed: ${grandTotal}`);
  console.log(`Total Tests Passed:   ${grandPassed}`);
  console.log(`Total Tests Failed:   ${grandFailed}`);
  console.log(`Total Wall Clock:     ${totalDuration}s`);
  console.log('================================================================\n');

  for (const r of results) {
    if (r.error) {
      console.log(`\n[DIAGNOSTIC ERROR] ${r.name}:\n${r.error}`);
    }
  }

  if (grandFailed > 0) {
    console.error('❌ E2E TEST SUITE FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL E2E TEST TIERS COMPLETED SUCCESSFULLY (100% PASS)!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
