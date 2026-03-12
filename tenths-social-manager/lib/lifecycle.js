// lib/lifecycle.js
'use strict';

const fs = require('fs');
const path = require('path');
const { readEnvFile, writeCredentials, readMeta, updateMeta, getStatus } = require('./cred-store');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

/**
 * Check health of all credentials for a service.
 * Returns { healthy, expired[], expiring_soon[], permanent[] }
 */
function checkService(service) {
  const status = getStatus(service);
  const expired = [];
  const expiringSoon = [];
  const permanent = [];
  const valid = [];

  for (const [key, info] of Object.entries(status)) {
    if (info.warning === 'expired') expired.push(key);
    else if (info.warning === 'expiring_soon') expiringSoon.push(key);
    else if (info.status === 'permanent') permanent.push(key);
    else valid.push(key);
  }

  return {
    healthy: expired.length === 0,
    expired,
    expiring_soon: expiringSoon,
    permanent,
    valid,
    needs_refresh: expiringSoon.length > 0
  };
}

/**
 * Attempt to refresh tokens for a service.
 * Currently supports Facebook token exchange.
 */
async function refreshService(service) {
  const env = readEnvFile();
  const meta = readMeta();
  const serviceMeta = meta[service] || {};

  // Find credentials that need refresh
  const toRefresh = Object.entries(serviceMeta).filter(([key, info]) => {
    if (!info.refresh_strategy || info.refresh_strategy === 'none') return false;
    if (!info.expires_at) return false;
    const expiresMs = new Date(info.expires_at).getTime();
    const now = Date.now();
    const refreshDays = info.refresh_before_days || 7;
    return expiresMs - now < refreshDays * 24 * 60 * 60 * 1000;
  });

  if (toRefresh.length === 0) {
    return { refreshed: false, reason: 'No tokens need refresh' };
  }

  // Service-specific refresh logic
  if (service === 'facebook') {
    return await refreshFacebook(env);
  }

  return { refreshed: false, reason: `No refresh strategy for service: ${service}`, needsReauth: true };
}

async function refreshFacebook(env) {
  const { FB_APP_ID, FB_APP_SECRET, FB_PAGE_ACCESS_TOKEN } = env;

  if (!FB_APP_ID || !FB_APP_SECRET) {
    return { refreshed: false, reason: 'FB_APP_ID or FB_APP_SECRET not set', needsReauth: true };
  }

  if (!FB_PAGE_ACCESS_TOKEN) {
    return { refreshed: false, reason: 'No existing token to exchange', needsReauth: true };
  }

  try {
    const url = `${GRAPH_API}/oauth/access_token`
      + `?grant_type=fb_exchange_token`
      + `&client_id=${FB_APP_ID}`
      + `&client_secret=${FB_APP_SECRET}`
      + `&fb_exchange_token=${FB_PAGE_ACCESS_TOKEN}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { refreshed: false, reason: `FB API: ${data.error.message}`, needsReauth: true };
    }

    if (!data.access_token) {
      return { refreshed: false, reason: 'No access_token in response', needsReauth: true };
    }

    // Store new token
    writeCredentials({ FB_PAGE_ACCESS_TOKEN: data.access_token });

    const expiresIn = data.expires_in; // seconds
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    updateMeta('facebook', 'FB_PAGE_ACCESS_TOKEN', {
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      refresh_strategy: 'token_exchange',
      last_refresh: new Date().toISOString(),
      status: expiresAt ? 'valid' : 'permanent'
    });

    return { refreshed: true, expires_at: expiresAt };

  } catch (err) {
    return { refreshed: false, reason: `Network error: ${err.message}`, needsReauth: false };
  }
}

module.exports = { checkService, refreshService };
