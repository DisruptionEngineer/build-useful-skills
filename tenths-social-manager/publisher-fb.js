const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getScreenshotPath } = require('./screenshots');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function assertCredentialsValid() {
  try {
    const output = execSync(
      'node credential-manager.js status facebook --json',
      { cwd: __dirname, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const status = JSON.parse(output);
    const fbStatus = status.facebook || {};
    const expired = Object.entries(fbStatus)
      .filter(([_, info]) => info.warning === 'expired')
      .map(([key]) => key);
    if (expired.length > 0) {
      throw new Error(
        `Facebook credentials expired: ${expired.join(', ')}. `
        + `Run: node credential-manager.js refresh facebook`
      );
    }
    const expiringSoon = Object.entries(fbStatus)
      .filter(([_, info]) => info.warning === 'expiring_soon')
      .map(([key]) => key);
    if (expiringSoon.length > 0) {
      console.warn(`[fb] Warning: tokens expiring soon: ${expiringSoon.join(', ')}. `
        + `Run: node credential-manager.js refresh facebook`);
    }
  } catch (err) {
    // If credential-manager hasn't been set up yet (no metadata), skip the check
    if (err.status === undefined && err.message?.includes('ENOENT')) return;
    // If exit code 1, credentials are expired
    if (err.status === 1) {
      throw new Error('Facebook credentials expired. Run: node credential-manager.js refresh facebook');
    }
    // Other errors: log warning but don't block (graceful degradation)
    if (!err.message?.includes('expired')) {
      console.warn(`[fb] Credential check warning: ${err.message}`);
    } else {
      throw err;
    }
  }
}

function getFBConfig() {
  assertCredentialsValid();
  return {
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    appId: process.env.FB_APP_ID,
    appSecret: process.env.FB_APP_SECRET
  };
}

async function postToFacebook(post, imagePath = null) {
  const { pageId, accessToken } = getFBConfig();
  if (!pageId || !accessToken) {
    throw new Error('FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set');
  }

  const fbContent = post.content.fb;
  if (!fbContent || !fbContent.text) {
    throw new Error('No Facebook content in post');
  }

  const text = fbContent.hashtags && fbContent.hashtags.length
    ? `${fbContent.text}\n\n${fbContent.hashtags.join(' ')}`
    : fbContent.text;

  // Use explicit imagePath if provided (e.g., racenight screenshot), else fall back to theme lookup
  const screenshotPath = imagePath || getScreenshotPath(post.theme);

  if (screenshotPath) {
    return await postWithPhoto(pageId, accessToken, text, screenshotPath);
  } else {
    return await postTextOnly(pageId, accessToken, text);
  }
}

async function postTextOnly(pageId, accessToken, message) {
  const res = await fetch(`${GRAPH_API}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken })
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.id;
}

async function postWithPhoto(pageId, accessToken, message, imagePath) {
  const { readFileSync } = require('fs');
  const { basename } = require('path');

  const imageBuffer = readFileSync(imagePath);
  const blob = new Blob([imageBuffer], { type: 'image/png' });

  const form = new FormData();
  form.set('message', message);
  form.set('access_token', accessToken);
  form.set('source', blob, basename(imagePath));

  const res = await fetch(`${GRAPH_API}/${pageId}/photos`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.post_id || data.id;
}

/**
 * Schedule a Facebook post for a future time.
 * The post appears in Facebook Business Suite → Scheduled Posts.
 *
 * @param {object} post - Standard post object with post.content.fb
 * @param {number} minutesFromNow - Minutes until publish (min 10, max ~6 months)
 * @returns {{ id: string, scheduled_time: string }} - FB post ID and scheduled ISO time
 */
async function scheduleToFacebook(post, minutesFromNow = 30, imagePath = null) {
  const { pageId, accessToken } = getFBConfig();
  if (!pageId || !accessToken) {
    throw new Error('FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set');
  }

  const fbContent = post.content.fb;
  if (!fbContent || !fbContent.text) {
    throw new Error('No Facebook content in post');
  }

  const text = fbContent.hashtags && fbContent.hashtags.length
    ? `${fbContent.text}\n\n${fbContent.hashtags.join(' ')}`
    : fbContent.text;

  // Enforce minimum 10 minutes per Graph API requirement
  const mins = Math.max(minutesFromNow, 10);
  const scheduledTime = Math.floor(Date.now() / 1000) + (mins * 60);
  const scheduledISO = new Date(scheduledTime * 1000).toISOString();

  // Use explicit imagePath if provided (e.g., tip screenshot), else fall back to theme lookup
  const screenshotPath = imagePath || getScreenshotPath(post.theme);

  let postId;
  if (screenshotPath) {
    postId = await scheduleWithPhoto(pageId, accessToken, text, screenshotPath, scheduledTime);
  } else {
    postId = await scheduleTextOnly(pageId, accessToken, text, scheduledTime);
  }

  return { id: postId, scheduled_time: scheduledISO };
}

async function scheduleTextOnly(pageId, accessToken, message, scheduledTime) {
  const res = await fetch(`${GRAPH_API}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      access_token: accessToken,
      published: false,
      scheduled_publish_time: scheduledTime,
      unpublished_content_type: 'SCHEDULED'
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB Schedule API: ${data.error.message}`);
  return data.id;
}

async function scheduleWithPhoto(pageId, accessToken, message, imagePath, scheduledTime) {
  const { FormData } = await import('formdata-node');
  const { fileFromPath } = await import('formdata-node/file-from-path');

  const form = new FormData();
  form.set('message', message);
  form.set('access_token', accessToken);
  form.set('source', await fileFromPath(imagePath));
  form.set('published', 'false');
  form.set('scheduled_publish_time', String(scheduledTime));
  form.set('unpublished_content_type', 'SCHEDULED');

  const res = await fetch(`${GRAPH_API}/${pageId}/photos`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB Schedule API: ${data.error.message}`);
  return data.post_id || data.id;
}

/**
 * Search a Facebook group's recent posts for setup-help keywords.
 * Returns matching posts sorted by relevance score.
 *
 * @param {string} groupId - Facebook Group ID
 * @param {string[]} keywords - Additional keywords to search for (optional)
 * @param {number} limit - Max posts to fetch from group feed (default 100)
 * @returns {Array<{ id, message, from, created_time, permalink, score, matched_keywords }>}
 */
async function searchGroupPosts(groupId, keywords = [], limit = 100) {
  const { accessToken } = getFBConfig();
  if (!accessToken) throw new Error('FB_PAGE_ACCESS_TOKEN not set');

  // Core setup-related keywords that indicate someone needs help
  const SETUP_KEYWORDS = [
    'setup', 'set up', 'set-up', 'help', 'advice', 'suggestion',
    'push', 'loose', 'tight', 'handling', 'understeer', 'oversteer',
    'tire pressure', 'cross weight', 'corner weight', 'wedge',
    'gear ratio', 'spring rate', 'sway bar', 'shock',
    'won\'t turn', 'plows', 'snaps loose', 'entry', 'exit',
    'what should', 'how do i', 'any tips', 'first time', 'new to',
    'struggling', 'can\'t get', 'having trouble'
  ];
  const allKeywords = [...SETUP_KEYWORDS, ...keywords.map(k => k.toLowerCase())];

  // Fetch recent group posts
  const url = `${GRAPH_API}/${groupId}/feed`
    + `?fields=id,message,from,created_time,permalink_url`
    + `&limit=${limit}`
    + `&access_token=${accessToken}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`FB Group API: ${data.error.message}`);

  if (!data.data || !data.data.length) return [];

  // Score each post by keyword matches
  const scored = data.data
    .filter(post => post.message) // skip posts with no text
    .map(post => {
      const msg = post.message.toLowerCase();
      const matched = allKeywords.filter(kw => msg.includes(kw));
      // Bonus for question marks (likely asking for help)
      const questionBonus = (post.message.match(/\?/g) || []).length * 2;
      return {
        id: post.id,
        message: post.message,
        from: post.from?.name || 'Unknown',
        created_time: post.created_time,
        permalink: post.permalink_url || `https://facebook.com/${post.id}`,
        score: matched.length + questionBonus,
        matched_keywords: [...new Set(matched)]
      };
    })
    .filter(post => post.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

async function refreshPageToken() {
  const { appId, appSecret, accessToken } = getFBConfig();
  if (!appId || !appSecret) {
    console.warn('[fb] Cannot refresh: FB_APP_ID or FB_APP_SECRET not set');
    return null;
  }
  const url = `${GRAPH_API}/oauth/access_token`
    + `?grant_type=fb_exchange_token`
    + `&client_id=${appId}`
    + `&client_secret=${appSecret}`
    + `&fb_exchange_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`FB token refresh: ${data.error.message}`);
  }
  return data.access_token;
}

/**
 * Fetch recent posts from the Facebook Page feed.
 * @param {number} limit - Number of posts to fetch (default 5)
 * @returns {Array<{ id, message, created_time }>}
 */
async function fetchRecentPagePosts(limit = 5) {
  const { pageId, accessToken } = getFBConfig();
  if (!pageId || !accessToken) throw new Error('FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set');

  const url = `${GRAPH_API}/${pageId}/posts`
    + `?fields=id,message,created_time`
    + `&limit=${limit}`
    + `&access_token=${accessToken}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.data || [];
}

/**
 * Delete a Facebook post by ID.
 * @param {string} postId - The FB post ID to delete
 * @returns {boolean} true on success
 */
async function deleteFBPost(postId) {
  const { accessToken } = getFBConfig();
  if (!accessToken) throw new Error('FB_PAGE_ACCESS_TOKEN not set');

  const res = await fetch(`${GRAPH_API}/${postId}?access_token=${accessToken}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.success === true;
}

module.exports = { postToFacebook, scheduleToFacebook, searchGroupPosts, refreshPageToken, fetchRecentPagePosts, deleteFBPost };
