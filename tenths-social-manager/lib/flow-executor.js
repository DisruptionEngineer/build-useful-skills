// lib/flow-executor.js
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { resolveTemplate } = require('./template');
const { readEnvFile, writeCredentials, updateMeta, getStatus } = require('./cred-store');

const DATA_DIR = path.join(process.env.HOME, '.agents', 'data', 'credential-manager');
const BROWSER_STATE_DIR = path.join(DATA_DIR, 'browser-state');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const RESUME_DIR = path.join(DATA_DIR, 'resume');
const RUNS_DIR = path.join(DATA_DIR, 'runs');

const RETRY_DELAYS = [1000, 3000, 5000];
const HUMAN_FALLBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL = 10000; // 10 seconds

/**
 * Execute a complete credential flow from a parsed YAML definition.
 * @param {object} flowDef - Parsed YAML flow definition
 * @param {string} service - Service name (e.g., 'facebook')
 * @param {object|null} initialCtx - Pre-built context for resume (null = fresh start)
 */
async function executeFlow(flowDef, service, initialCtx = null) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runLog = { flow: service, started_at: new Date().toISOString(), steps: [] };

  // Build context (or use resume context)
  const ctx = initialCtx || {
    env: readEnvFile(),
    creds: {},
    state: {}
  };

  // Load existing creds into context (only on fresh start)
  if (!initialCtx) {
    const existingEnv = readEnvFile();
    for (const key of flowDef.credentials_required || []) {
      if (existingEnv[key]) ctx.creds[key] = existingEnv[key];
    }
  }

  let browser = null;
  let page = null;

  try {
    const steps = flowDef.steps || [];
    let i = 0;

    while (i < steps.length) {
      const step = steps[i];
      const stepLog = { id: step.id, type: step.type, status: 'running', started_at: new Date().toISOString() };

      console.log(`[flow:${service}] Step ${i + 1}/${steps.length}: ${step.id} (${step.type})`);

      try {
        const result = await executeStep(step, ctx, { browser, page, service, flowDef });

        // Handle browser/page references returned from browser steps
        if (result.browser) browser = result.browser;
        if (result.page) page = result.page;

        // Handle flow control
        if (result.skip_to) {
          const targetIdx = steps.findIndex(s => s.id === result.skip_to);
          if (targetIdx === -1) throw new Error(`skip_to target not found: ${result.skip_to}`);
          i = targetIdx;
          stepLog.status = 'skipped_to';
          stepLog.target = result.skip_to;
          runLog.steps.push(stepLog);
          continue;
        }

        if (result.human_fallback) {
          // Save resume state
          const resumeState = {
            flow_name: service,
            current_step_id: step.id,
            current_step_index: i,
            accumulated_state: ctx.state,
            credentials_so_far: ctx.creds,
            reason: result.reason || 'unknown',
            screenshot_path: result.screenshot_path || null,
            paused_at: new Date().toISOString()
          };
          fs.mkdirSync(RESUME_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(RESUME_DIR, `${service}.json`),
            JSON.stringify(resumeState, null, 2)
          );

          stepLog.status = 'human_fallback';
          stepLog.reason = result.reason;
          runLog.steps.push(stepLog);
          saveRunLog(runLog, runId);

          return { status: 'human_fallback', step_id: step.id, reason: result.reason };
        }

        stepLog.status = 'success';
        runLog.steps.push(stepLog);

      } catch (err) {
        stepLog.status = 'failed';
        stepLog.error = err.message;
        runLog.steps.push(stepLog);

        // Check for on_failure handler
        const failHandler = step.on_failure;
        if (failHandler === 'human_fallback') {
          const screenshotPath = await captureDebugScreenshot(page, step.id, service);
          const resumeState = {
            flow_name: service,
            current_step_id: step.id,
            current_step_index: i,
            accumulated_state: ctx.state,
            credentials_so_far: ctx.creds,
            reason: `step_failed: ${err.message}`,
            screenshot_path: screenshotPath,
            paused_at: new Date().toISOString()
          };
          fs.mkdirSync(RESUME_DIR, { recursive: true });
          fs.writeFileSync(
            path.join(RESUME_DIR, `${service}.json`),
            JSON.stringify(resumeState, null, 2)
          );
          saveRunLog(runLog, runId);
          return { status: 'human_fallback', step_id: step.id, reason: err.message };
        }

        if (typeof failHandler === 'string' && failHandler.startsWith('restart_from:')) {
          const target = failHandler.split(':')[1];
          const targetIdx = steps.findIndex(s => s.id === target);
          if (targetIdx === -1) throw new Error(`restart_from target not found: ${target}`);
          i = targetIdx;
          continue;
        }

        throw err; // Unhandled failure
      }

      i++;
    }

    runLog.completed_at = new Date().toISOString();
    runLog.status = 'success';
    saveRunLog(runLog, runId);
    return { status: 'success' };

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Resume a flow from saved state.
 */
async function resumeFlow(resumeState, service) {
  const yaml = require('js-yaml');
  const flowPath = path.join(__dirname, '..', 'flows', `${service}.yaml`);
  const flowDef = yaml.load(fs.readFileSync(flowPath, 'utf8'));

  // Inject resume state
  const ctx = {
    env: readEnvFile(),
    creds: resumeState.credentials_so_far || {},
    state: resumeState.accumulated_state || {}
  };

  // Find step index — resume FROM the step that paused (retry it)
  const startIdx = flowDef.steps.findIndex(s => s.id === resumeState.current_step_id);
  if (startIdx === -1) throw new Error(`Resume step not found: ${resumeState.current_step_id}`);

  // Modify flow to start from resume point, pass resume context
  const resumeFlowDef = { ...flowDef, steps: flowDef.steps.slice(startIdx) };

  return executeFlow(resumeFlowDef, service, ctx);
}

/**
 * Execute a single step based on its type.
 */
async function executeStep(step, ctx, refs) {
  // Retry wrapper
  const maxRetries = step.retries || 3;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      switch (step.type) {
        case 'check_credentials':
          return execCheckCredentials(step, ctx);
        case 'browser':
          return await execBrowser(step, ctx, refs);
        case 'browser_sequence':
          return await execBrowserSequence(step, ctx, refs);
        case 'http':
          return await execHttp(step, ctx);
        case 'store':
          return execStore(step, ctx, refs.service, refs.flowDef);
        case 'notify':
          return execNotify(step, ctx);
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[attempt] || 5000;
        console.log(`  Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message}`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// --- Step type handlers ---

function execCheckCredentials(step, ctx) {
  const keys = step.keys || [];
  const allPresent = keys.every(k => ctx.creds[k] || ctx.env[k]);

  if (allPresent && step.on_all_present) {
    const target = step.on_all_present.replace('skip_to:', '');
    return { skip_to: target };
  }
  return {};
}

async function execBrowser(step, ctx, refs) {
  let { browser, page } = refs;

  // Launch browser if needed
  if (!browser) {
    fs.mkdirSync(BROWSER_STATE_DIR, { recursive: true });
    browser = await chromium.launchPersistentContext(BROWSER_STATE_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 }
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  const action = step.action;
  const resolved = resolveTemplate(step, ctx);

  switch (action) {
    case 'navigate':
      await page.goto(resolved.url, { waitUntil: resolved.wait_for || 'networkidle', timeout: resolved.timeout || 30000 });

      // Check for login requirement
      if (step.detect_login) {
        const loginSelector = step.detect_login.replace('selector:', '');
        const loginNeeded = await page.$(loginSelector);
        if (loginNeeded && step.on_login_required) {
          for (const loginStep of step.on_login_required) {
            const resolvedLogin = resolveTemplate(loginStep, ctx);
            await execBrowserAction(page, resolvedLogin, ctx, refs.service);
          }
        }
      }
      break;

    case 'fill':
      await page.fill(resolved.selector, resolved.value, { timeout: resolved.timeout || 10000 });
      break;

    case 'click':
      await page.click(resolved.selector, { timeout: resolved.timeout || 10000 });
      break;

    case 'extract':
      const el = await page.$(resolved.selector);
      if (!el) throw new Error(`Element not found: ${resolved.selector}`);
      const value = await el.inputValue().catch(() => el.textContent());
      if (resolved.store_as) {
        if (resolved.store_as.startsWith('_')) {
          ctx.state[resolved.store_as] = value;
        } else {
          ctx.creds[resolved.store_as] = value;
        }
      }
      break;

    case 'wait_for':
      try {
        await page.waitForSelector(resolved.selector, { timeout: resolved.timeout || 30000 });
      } catch (err) {
        if (resolved.on_timeout === 'human_fallback') {
          const screenshotPath = await captureDebugScreenshot(page, step.id || 'wait_for', refs.service);
          return { human_fallback: true, reason: 'timeout', screenshot_path: screenshotPath, browser, page };
        }
        throw err;
      }
      break;

    case 'conditional':
      const found = await page.$(resolved.check?.replace('selector:', '') || '');
      if (found && step.on_found) {
        if (step.on_found.startsWith('click_and_skip_to:')) {
          await found.click();
          return { skip_to: step.on_found.split(':')[1], browser, page };
        }
        return { skip_to: step.on_found, browser, page };
      }
      // on_not_found: continue means just proceed to next step
      break;

    default:
      throw new Error(`Unknown browser action: ${action}`);
  }

  // Screenshot every step for debugging
  await captureDebugScreenshot(page, step.id || action, refs.service);

  return { browser, page };
}

async function execBrowserAction(page, action, ctx, service) {
  switch (action.action) {
    case 'fill':
      await page.fill(action.selector, action.value, { timeout: action.timeout || 10000 });
      break;
    case 'click':
      await page.click(action.selector, { timeout: action.timeout || 10000 });
      break;
    case 'wait_for':
      try {
        await page.waitForSelector(action.selector, { timeout: action.timeout || 30000 });
      } catch (err) {
        if (action.on_timeout === 'human_fallback') {
          const screenshotPath = await captureDebugScreenshot(page, 'login_wait', service);
          throw Object.assign(err, { human_fallback: true, screenshot_path: screenshotPath });
        }
        throw err;
      }
      break;
    default:
      throw new Error(`Unknown login action: ${action.action}`);
  }
}

async function execBrowserSequence(step, ctx, refs) {
  let { browser, page } = refs;

  // Launch browser if needed
  if (!browser) {
    fs.mkdirSync(BROWSER_STATE_DIR, { recursive: true });
    browser = await chromium.launchPersistentContext(BROWSER_STATE_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 }
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  for (const subStep of step.steps) {
    const resolved = resolveTemplate(subStep, ctx);

    // Dispatch by action type — browser_sequence handles all action types inline
    switch (resolved.action) {
      case 'navigate':
        await page.goto(resolved.url, { waitUntil: resolved.wait_for || 'networkidle', timeout: resolved.timeout || 30000 });
        break;
      case 'fill':
        await page.fill(resolved.selector, resolved.value, { timeout: resolved.timeout || 10000 });
        break;
      case 'click':
        await page.click(resolved.selector, { timeout: resolved.timeout || 10000 });
        break;
      case 'extract': {
        const el = await page.$(resolved.selector);
        if (!el) throw new Error(`Element not found: ${resolved.selector}`);
        const value = await el.inputValue().catch(() => el.textContent());
        if (resolved.store_as) {
          if (resolved.store_as.startsWith('_')) {
            ctx.state[resolved.store_as] = value;
          } else {
            ctx.creds[resolved.store_as] = value;
          }
        }
        break;
      }
      case 'wait_for':
        await page.waitForSelector(resolved.selector, { timeout: resolved.timeout || 30000 });
        break;
      default:
        throw new Error(`Unknown browser_sequence action: ${resolved.action}`);
    }

    await captureDebugScreenshot(page, `${step.id}-${resolved.action}`, refs.service);
  }

  return { browser, page };
}

async function execHttp(step, ctx) {
  const resolved = resolveTemplate(step, ctx);

  let url = resolved.url;
  if (resolved.params) {
    const params = new URLSearchParams(resolved.params);
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const options = { method: resolved.method || 'GET' };
  if (resolved.body) {
    options.headers = { 'Content-Type': 'application/json', ...(resolved.headers || {}) };
    options.body = JSON.stringify(resolved.body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  // Check expected status
  if (resolved.expect?.status && res.status !== resolved.expect.status) {
    throw new Error(`HTTP ${res.status} (expected ${resolved.expect.status}): ${JSON.stringify(data)}`);
  }

  // Extract values from response
  if (resolved.extract) {
    for (const [responseKey, storeKey] of Object.entries(resolved.extract)) {
      const value = data[responseKey];
      if (value !== undefined) {
        if (storeKey.startsWith('_')) {
          ctx.state[storeKey] = String(value);
        } else {
          ctx.creds[storeKey] = String(value);
        }
      }
    }
  }

  return {};
}

function execStore(step, ctx, service, flowDef) {
  const keys = step.keys || [];
  const credsToStore = {};

  for (const key of keys) {
    const value = ctx.creds[key] || ctx.state[key] || ctx.env[key];
    if (value) {
      credsToStore[key] = value;
    }
  }

  if (Object.keys(credsToStore).length === 0) {
    console.log('  No credentials to store.');
    return {};
  }

  writeCredentials(credsToStore);

  // Update metadata
  const refreshConfig = flowDef.refresh || {};
  const refreshBeforeDays = refreshConfig.refresh_before_days || 7;
  const now = new Date().toISOString();

  for (const key of keys) {
    const isToken = key.includes('TOKEN') || key.includes('SECRET');
    const expiresIn = ctx.state._token_expires_in;

    let expiresAt = null;
    if (isToken && expiresIn) {
      expiresAt = new Date(Date.now() + parseInt(expiresIn) * 1000).toISOString();
    }

    updateMeta(service, key, {
      issued_at: now,
      expires_at: expiresAt,
      refresh_strategy: expiresAt ? (refreshConfig.strategy || 'none') : 'none',
      refresh_before_days: refreshBeforeDays,
      status: expiresAt ? 'valid' : 'permanent'
    });
  }

  console.log(`  Stored ${Object.keys(credsToStore).length} credentials.`);
  return {};
}

function execNotify(step, ctx) {
  const resolved = resolveTemplate(step, ctx);
  // For now, just log. Discord webhook integration can be added.
  console.log(`[notify:${resolved.channel}] ${resolved.message}`);
  return {};
}

// --- Helpers ---

async function captureDebugScreenshot(page, stepId, service) {
  if (!page) return null;
  try {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filename = `${service}-${stepId}-${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: filepath, type: 'png' });
    return filepath;
  } catch {
    return null;
  }
}

function saveRunLog(runLog, runId) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNS_DIR, `${runId}.json`),
    JSON.stringify(runLog, null, 2)
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { executeFlow, resumeFlow };
