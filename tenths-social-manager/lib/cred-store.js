// lib/cred-store.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_ENV_PATH = path.join(os.homedir(), '.agents', 'config', 'tenths-social-env.sh');
const DEFAULT_META_PATH = path.join(os.homedir(), '.agents', 'data', 'credential-manager', 'credentials-meta.json');

function getEnvPath() {
  return process.env.CRED_STORE_ENV_PATH || DEFAULT_ENV_PATH;
}

function getMetaPath() {
  return process.env.CRED_STORE_META_PATH || DEFAULT_META_PATH;
}

/**
 * Parse env.sh file into key-value object.
 * Handles: export KEY="value", export KEY='value', export KEY=value
 * Correctly handles values containing = signs and quoted strings.
 */
function readEnvFile() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) return {};

  const content = fs.readFileSync(envPath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[match[1]] = val;
    }
  }
  return result;
}

/**
 * Write/update credentials in env.sh.
 * - Creates file with 0600 if absent
 * - Backs up existing file to .bak before modifying
 * - Replaces existing export lines in-place, appends new ones
 * - Performs read-back verification
 */
function writeCredentials(creds) {
  const envPath = getEnvPath();
  const dir = path.dirname(envPath);
  fs.mkdirSync(dir, { recursive: true });

  let lines = [];
  if (fs.existsSync(envPath)) {
    fs.copyFileSync(envPath, envPath + '.bak');
    lines = fs.readFileSync(envPath, 'utf8').split('\n');
  }

  const updated = new Set();

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && match[1] in creds) {
      const escaped = String(creds[match[1]]).replace(/"/g, '\\"');
      lines[i] = `export ${match[1]}="${escaped}"`;
      updated.add(match[1]);
    }
  }

  for (const [key, value] of Object.entries(creds)) {
    if (!updated.has(key)) {
      const escaped = String(value).replace(/"/g, '\\"');
      lines.push(`export ${key}="${escaped}"`);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  const output = lines.join('\n') + '\n';

  fs.writeFileSync(envPath, output, { mode: 0o600 });

  // Read-back verification
  const verify = readEnvFile();
  for (const [key, value] of Object.entries(creds)) {
    if (verify[key] !== value) {
      throw new Error(`Read-back verification failed for ${key}: expected "${value}", got "${verify[key]}"`);
    }
  }
}

/**
 * Read credentials-meta.json. Returns {} if absent.
 */
function readMeta() {
  const metaPath = getMetaPath();
  if (!fs.existsSync(metaPath)) return {};
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

/**
 * Update metadata for a specific credential within a service.
 */
function updateMeta(service, key, metadata) {
  const metaPath = getMetaPath();
  const dir = path.dirname(metaPath);
  fs.mkdirSync(dir, { recursive: true });

  const meta = readMeta();
  if (!meta[service]) meta[service] = {};
  meta[service][key] = { ...metadata, last_refresh: metadata.last_refresh || null };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Get status for all credentials of a service.
 * Returns per-key status with warnings for expiring tokens.
 */
function getStatus(service, refreshBeforeDays = 7) {
  const meta = readMeta();
  const serviceMeta = meta[service];
  if (!serviceMeta) return {};

  const now = Date.now();
  const warnMs = refreshBeforeDays * 24 * 60 * 60 * 1000;
  const result = {};

  for (const [key, entry] of Object.entries(serviceMeta)) {
    const status = { ...entry };
    if (entry.expires_at) {
      const expiresMs = new Date(entry.expires_at).getTime();
      if (expiresMs < now) {
        status.warning = 'expired';
        status.status = 'expired';
      } else if (expiresMs - now < warnMs) {
        status.warning = 'expiring_soon';
        status.status = 'expiring';
      }
    }
    result[key] = status;
  }
  return result;
}

module.exports = { readEnvFile, writeCredentials, readMeta, updateMeta, getStatus };
