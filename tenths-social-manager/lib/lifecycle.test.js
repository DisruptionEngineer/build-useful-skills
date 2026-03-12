// lib/lifecycle.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), `lifecycle-test-${Date.now()}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

process.env.CRED_STORE_ENV_PATH = path.join(TEST_DIR, 'test-env.sh');
process.env.CRED_STORE_META_PATH = path.join(TEST_DIR, 'credentials-meta.json');

const { writeCredentials, updateMeta } = require('./cred-store');
const { refreshService, checkService } = require('./lifecycle');

// Setup: write fake FB credentials
writeCredentials({
  FB_APP_ID: 'test-app-id',
  FB_APP_SECRET: 'test-app-secret',
  FB_PAGE_ACCESS_TOKEN: 'test-token',
  FB_PAGE_ID: '12345'
});

(async () => {
  try {
    // Test 1: checkService returns valid for permanent creds
    updateMeta('facebook', 'FB_APP_ID', {
      issued_at: '2026-03-11T00:00:00Z',
      expires_at: null,
      refresh_strategy: 'none',
      status: 'permanent'
    });
    const check1 = checkService('facebook');
    assert.ok(check1.healthy, 'Should be healthy with permanent creds');

    // Test 2: checkService detects expired tokens
    updateMeta('facebook', 'FB_PAGE_ACCESS_TOKEN', {
      issued_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-02-01T00:00:00Z', // In the past
      refresh_strategy: 'token_exchange',
      status: 'valid'
    });
    const check2 = checkService('facebook');
    assert.ok(!check2.healthy, 'Should be unhealthy with expired token');
    assert.ok(check2.expired.includes('FB_PAGE_ACCESS_TOKEN'), 'Should list expired key');

    // Test 3: checkService detects expiring_soon tokens
    updateMeta('facebook', 'FB_PAGE_ACCESS_TOKEN', {
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), // 3 days
      refresh_strategy: 'token_exchange',
      status: 'valid'
    });
    const check3 = checkService('facebook');
    assert.ok(check3.healthy, 'Token expiring in 3d should still be healthy');
    assert.ok(check3.needs_refresh, 'Token expiring in 3d should flag needs_refresh');
    assert.ok(check3.expiring_soon.includes('FB_PAGE_ACCESS_TOKEN'), 'Should be in expiring_soon');

    // Test 4: refreshService fails gracefully with fake token
    const result = await refreshService('facebook');
    assert.ok(!result.refreshed, 'Should not succeed with fake token');

    console.log('✅ All lifecycle tests passed');
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  } finally {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
})();
