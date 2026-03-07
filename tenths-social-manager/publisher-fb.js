const fs = require('fs');
const path = require('path');
const { getScreenshotPath } = require('./screenshots');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function getFBConfig() {
  return {
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    appId: process.env.FB_APP_ID,
    appSecret: process.env.FB_APP_SECRET
  };
}

async function postToFacebook(post) {
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

  const screenshotPath = getScreenshotPath(post.theme);

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
  const { FormData } = await import('formdata-node');
  const { fileFromPath } = await import('formdata-node/file-from-path');

  const form = new FormData();
  form.set('message', message);
  form.set('access_token', accessToken);
  form.set('source', await fileFromPath(imagePath));

  const res = await fetch(`${GRAPH_API}/${pageId}/photos`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.post_id || data.id;
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

module.exports = { postToFacebook, refreshPageToken };
