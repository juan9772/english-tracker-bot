import { getLocalDateString, getPreviousDateString, getLocalDateParts, getDayOfWeek } from '../api/_time.js';

const timezone = 'America/Argentina/Buenos_Aires';

let mockNow = new Date('2026-07-12T12:00:00Z'); // Sunday noon UTC

function printState(label) {
  const currentDateStr = getLocalDateString(mockNow, timezone);
  const previousDateStr = getPreviousDateString(currentDateStr);
  const localDay = getDayOfWeek(currentDateStr);
  console.log(`[${label}] mockNow=${mockNow.toISOString()} | localDate=${currentDateStr} | prevDate=${previousDateStr} | dayOfWeek=${localDay}`);
}

printState('Test 1-5 (Sunday noon UTC)');

// Test 6: Advance 24 hours
mockNow = new Date(mockNow.getTime() + 24 * 60 * 60 * 1000);
printState('Test 6-8 (Monday noon UTC)');

// Test 9: Advance 12 hours
mockNow = new Date(mockNow.getTime() + 12 * 60 * 60 * 1000);
printState('Test 9 (Tuesday 00:00 UTC)');

// Test 10: Advance 24 hours
mockNow = new Date(mockNow.getTime() + 24 * 60 * 60 * 1000);
printState('Test 10 (Wednesday 00:00 UTC)');

// Test 11 (part 1): Advance 24 hours
mockNow = new Date(mockNow.getTime() + 24 * 60 * 60 * 1000);
printState('Test 11 part 1 (Thursday 00:00 UTC)');

// Test 11 (part 2): Advance 24 hours
mockNow = new Date(mockNow.getTime() + 24 * 60 * 60 * 1000);
printState('Test 11 part 2 (Friday 00:00 UTC)');

// Test 12: Advance 3 days
mockNow = new Date(mockNow.getTime() + 3 * 24 * 60 * 60 * 1000);
printState('Test 12 (Monday 00:00 UTC)');
