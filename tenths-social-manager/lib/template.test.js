// lib/template.test.js
const { resolveTemplate } = require('./template');
const assert = require('assert');

// Test 1: resolve env vars
const ctx1 = { env: { FB_APP_ID: '123' }, creds: {}, state: {} };
assert.strictEqual(resolveTemplate('id={{env.FB_APP_ID}}', ctx1), 'id=123');

// Test 2: resolve creds
const ctx2 = { env: {}, creds: { TOKEN: 'abc' }, state: {} };
assert.strictEqual(resolveTemplate('t={{creds.TOKEN}}', ctx2), 't=abc');

// Test 3: resolve state
const ctx3 = { env: {}, creds: {}, state: { short_lived: 'xyz' } };
assert.strictEqual(resolveTemplate('{{state.short_lived}}', ctx3), 'xyz');

// Test 4: multiple vars in one string
const ctx4 = { env: { A: '1' }, creds: { B: '2' }, state: { C: '3' } };
assert.strictEqual(
  resolveTemplate('{{env.A}}-{{creds.B}}-{{state.C}}', ctx4),
  '1-2-3'
);

// Test 5: missing var returns empty string
const ctx5 = { env: {}, creds: {}, state: {} };
assert.strictEqual(resolveTemplate('x={{env.MISSING}}', ctx5), 'x=');

// Test 6: no templates returns string unchanged
assert.strictEqual(resolveTemplate('plain text', ctx5), 'plain text');

// Test 7: resolve in object values (deep)
const obj = { url: '{{env.HOST}}/path', params: { id: '{{state.id}}' } };
const ctx7 = { env: { HOST: 'https://fb.com' }, creds: {}, state: { id: '42' } };
const result = resolveTemplate(obj, ctx7);
assert.deepStrictEqual(result, { url: 'https://fb.com/path', params: { id: '42' } });

console.log('✅ All template tests passed');
