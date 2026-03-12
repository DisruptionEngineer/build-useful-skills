// lib/cred-store.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use temp dir for test isolation
const TEST_DIR = path.join(os.tmpdir(), `cred-store-test-${Date.now()}`);
const TEST_ENV_PATH = path.join(TEST_DIR, 'test-env.sh');
const TEST_META_PATH = path.join(TEST_DIR, 'credentials-meta.json');

fs.mkdirSync(TEST_DIR, { recursive: true });

// Override paths before requiring module
process.env.CRED_STORE_ENV_PATH = TEST_ENV_PATH;
process.env.CRED_STORE_META_PATH = TEST_META_PATH;

const {
  readEnvFile,
  writeCredentials,
  readMeta,
  updateMeta,
  getStatus
} = require('./cred-store');

// Test 1: writeCredentials creates env.sh if absent
writeCredentials({ FB_APP_ID: '123', FB_APP_SECRET: 'secret' });
const content = fs.readFileSync(TEST_ENV_PATH, 'utf8');
assert.ok(content.includes('export FB_APP_ID="123"'), 'Should write FB_APP_ID');
assert.ok(content.includes('export FB_APP_SECRET="secret"'), 'Should write FB_APP_SECRET');

// Test 2: readEnvFile reads back values
const env = readEnvFile();
assert.strictEqual(env.FB_APP_ID, '123');
assert.strictEqual(env.FB_APP_SECRET, 'secret');

// Test 3: writeCredentials updates existing values in-place
writeCredentials({ FB_APP_ID: '456' });
const env2 = readEnvFile();
assert.strictEqual(env2.FB_APP_ID, '456', 'Should update FB_APP_ID');
assert.strictEqual(env2.FB_APP_SECRET, 'secret', 'Should preserve FB_APP_SECRET');

// Test 4: backup file created
assert.ok(fs.existsSync(TEST_ENV_PATH + '.bak'), 'Backup file should exist');

// Test 5: updateMeta writes metadata
updateMeta('facebook', 'FB_APP_ID', {
  issued_at: '2026-03-11T00:00:00Z',
  expires_at: null,
  refresh_strategy: 'none',
  status: 'permanent'
});
const meta = readMeta();
assert.strictEqual(meta.facebook.FB_APP_ID.status, 'permanent');

// Test 6: getStatus returns credential health
updateMeta('facebook', 'FB_PAGE_ACCESS_TOKEN', {
  issued_at: '2026-03-11T00:00:00Z',
  expires_at: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days
  refresh_strategy: 'token_exchange',
  status: 'valid'
});
const status = getStatus('facebook');
assert.ok(status.FB_PAGE_ACCESS_TOKEN, 'Should have token status');
// Token expiring within 7 days should be flagged
assert.strictEqual(status.FB_PAGE_ACCESS_TOKEN.warning, 'expiring_soon');

// Cleanup
fs.rmSync(TEST_DIR, { recursive: true, force: true });

console.log('✅ All cred-store tests passed');
