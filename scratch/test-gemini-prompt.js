import { formatTelegramHtml } from '../api/_queue.js';
import assert from 'assert';

console.log('--- Testing formatTelegramHtml ---');

// Test 1: Markdown bold to HTML bold
const mdBold = 'This is **bold** text and __another bold__';
const htmlBold = formatTelegramHtml(mdBold);
console.log('Test 1 Output:', htmlBold);
assert.strictEqual(htmlBold, 'This is <b>bold</b> text and <b>another bold</b>');

// Test 2: Markdown headers to <b>Header</b>
const mdHeader = '### 🧠 Qué mejoraría de tu versión';
const htmlHeader = formatTelegramHtml(mdHeader);
console.log('Test 2 Output:', htmlHeader);
assert.strictEqual(htmlHeader, '<b>🧠 Qué mejoraría de tu versión</b>');

// Test 3: Markdown blockquotes to <blockquote>
const mdQuote = '> when I should think\n> and when I should live';
const htmlQuote = formatTelegramHtml(mdQuote);
console.log('Test 3 Output:', htmlQuote);
assert.strictEqual(htmlQuote, '<blockquote>when I should think\nand when I should live</blockquote>');

// Test 4: Existing HTML tags preserved
const existingHtml = 'Tu idea se entiende. 🧠 <b>Qué mejoraría:</b>\n<blockquote>Natural version</blockquote>';
const htmlPreserved = formatTelegramHtml(existingHtml);
console.log('Test 4 Output:', htmlPreserved);
assert.strictEqual(htmlPreserved, existingHtml);

console.log('✅ All formatTelegramHtml tests passed successfully!');
