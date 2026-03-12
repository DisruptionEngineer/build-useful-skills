#!/usr/bin/env node
// credential-manager.js — CLI entrypoint for credential flow engine
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const lockfile = require('proper-lockfile');
const { readEnvFile, readMeta, getStatus } = require('./lib/cred-store');

const FLOWS_DIR = path.join(__dirname, 'flows');
const DATA_DIR = path.join(process.env.HOME, '.agents', 'data', 'credential-manager');

const COMMANDS = ['setup', 'status', 'refresh', 'resume', 'list'];

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [command, service] = args;
  const jsonFlag = process.argv.includes('--json');

  if (!command || !COMMANDS.includes(command)) {
    console.error(`Usage: credential-manager.js <${COMMANDS.join('|')}> [service] [--json]`);
    process.exit(1);
  }

  switch (command) {
    case 'list':
      return cmdList();
    case 'status':
      return cmdStatus(service, jsonFlag);
    case 'setup':
      if (!service) { console.error('Usage: credential-manager.js setup <service>'); process.exit(1); }
      return cmdSetup(service);
    case 'refresh':
      if (!service) { console.error('Usage: credential-manager.js refresh <service>'); process.exit(1); }
      return cmdRefresh(service);
    case 'resume':
      if (!service) { console.error('Usage: credential-manager.js resume <service>'); process.exit(1); }
      return cmdResume(service);
  }
}

function cmdList() {
  if (!fs.existsSync(FLOWS_DIR)) {
    console.log('No flows directory found. Create flows/ with YAML definitions.');
    process.exit(0);
  }
  const flows = fs.readdirSync(FLOWS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => {
      const content = yaml.load(fs.readFileSync(path.join(FLOWS_DIR, f), 'utf8'));
      return { name: content.name || path.basename(f, path.extname(f)), display_name: content.display_name || '', description: content.description || '' };
    });

  if (flows.length === 0) {
    console.log('No flow definitions found in flows/');
    process.exit(0);
  }

  console.log('Available credential flows:\n');
  for (const flow of flows) {
    console.log(`  ${flow.name.padEnd(20)} ${flow.display_name} — ${flow.description}`);
  }
}

function cmdStatus(service, jsonFlag) {
  const meta = readMeta();
  const env = readEnvFile();
  const services = service ? [service] : Object.keys(meta);

  if (services.length === 0) {
    console.log('No credentials tracked. Run `credential-manager.js setup <service>` first.');
    process.exit(0);
  }

  const output = {};
  for (const svc of services) {
    const status = getStatus(svc);
    output[svc] = status;

    if (!jsonFlag) {
      console.log(`${svc}:`);
      for (const [key, info] of Object.entries(status)) {
        const present = env[key] ? '✓' : '✗';
        const expiry = info.expires_at
          ? `expires ${info.expires_at.split('T')[0]} (${Math.ceil((new Date(info.expires_at) - Date.now()) / 86400000)}d)`
          : 'permanent';
        const warn = info.warning ? ` ⚠ ${info.warning}` : '';
        console.log(`  ${key.padEnd(28)} ${expiry}  ${present}${warn}`);
      }
      console.log('');
    }
  }

  if (jsonFlag) {
    console.log(JSON.stringify(output, null, 2));
  }

  // Exit code 0 if all valid, 1 if any expired
  const hasExpired = Object.values(output).some(svc =>
    Object.values(svc).some(c => c.warning === 'expired')
  );
  process.exit(hasExpired ? 1 : 0);
}

async function cmdSetup(service) {
  const flowPath = path.join(FLOWS_DIR, `${service}.yaml`);
  if (!fs.existsSync(flowPath)) {
    console.error(`No flow definition found: ${flowPath}`);
    console.error(`Run 'credential-manager.js list' to see available flows.`);
    process.exit(1);
  }

  // Acquire lock
  const lockDir = path.join(DATA_DIR);
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${service}.lock`);
  fs.writeFileSync(lockPath, '', { flag: 'a' }); // ensure file exists

  let release;
  try {
    release = await lockfile.lock(lockPath, { stale: 600000 }); // 10 min stale
  } catch (err) {
    console.error(`Another ${service} flow is already running. Wait or delete ${lockPath}`);
    process.exit(1);
  }

  try {
    // Check if creds already valid
    const status = getStatus(service);
    const flow = yaml.load(fs.readFileSync(flowPath, 'utf8'));
    const required = flow.credentials_required || [];
    const env = readEnvFile();
    const allPresent = required.every(k => env[k] && env[k].length > 0);
    const noneExpired = !Object.values(status).some(c => c.warning === 'expired');

    if (allPresent && noneExpired) {
      console.log(`All ${service} credentials are present and valid.`);
      process.exit(3);
    }

    // TODO: Task 5 — invoke flow executor
    const { executeFlow } = require('./lib/flow-executor');
    const result = await executeFlow(flow, service);

    if (result.status === 'human_fallback') {
      console.log(`Flow paused — human intervention needed at step: ${result.step_id}`);
      console.log(`Reason: ${result.reason}`);
      console.log(`Resume with: node credential-manager.js resume ${service}`);
      process.exit(2);
    }

    console.log(`✅ ${service} credentials configured successfully.`);
    process.exit(0);
  } catch (err) {
    console.error(`Setup failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (release) await release();
  }
}

async function cmdRefresh(service) {
  // TODO: Task 7 — invoke lifecycle refresh
  const { refreshService } = require('./lib/lifecycle');
  try {
    const result = await refreshService(service);
    if (result.refreshed) {
      console.log(`✅ ${service} token refreshed. New expiry: ${result.expires_at}`);
      process.exit(0);
    } else {
      console.log(`${service}: ${result.reason}`);
      process.exit(result.needsReauth ? 1 : 3);
    }
  } catch (err) {
    console.error(`Refresh failed: ${err.message}`);
    process.exit(1);
  }
}

async function cmdResume(service) {
  const resumePath = path.join(DATA_DIR, 'resume', `${service}.json`);
  if (!fs.existsSync(resumePath)) {
    console.error(`No paused flow found for ${service}.`);
    console.error(`Run 'credential-manager.js setup ${service}' to start a new flow.`);
    process.exit(1);
  }

  // TODO: Task 6 — invoke flow executor with resume state
  const { resumeFlow } = require('./lib/flow-executor');
  const resumeState = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
  try {
    const result = await resumeFlow(resumeState, service);
    if (result.status === 'success') {
      fs.unlinkSync(resumePath);
      console.log(`✅ ${service} flow resumed and completed successfully.`);
      process.exit(0);
    } else if (result.status === 'human_fallback') {
      console.log(`Flow paused again at step: ${result.step_id}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`Resume failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
