const fs = require('fs');
const path = require('path');

const GRAPH_API = 'https://graph.facebook.com/v19.0';
const INSIGHTS_PATH = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-fb-insights.json'
);
const QUEUE_PATH = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-social-queue.json'
);

function loadInsights() {
  try {
    return JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8'));
  } catch {
    return { last_fetched: null, posts: {}, theme_performance: {} };
  }
}

function saveInsights(data) {
  fs.mkdirSync(path.dirname(INSIGHTS_PATH), { recursive: true });
  fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(data, null, 2));
}

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return { posts: [] };
  }
}

async function fetchFBInsights() {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) {
    console.error('[insights] FB credentials not set');
    return;
  }

  const since = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const fields = 'id,created_time,insights.metric('
    + 'post_reactions_by_type_total,post_comments,post_shares,post_clicks)';
  const url = `${GRAPH_API}/${pageId}/posts`
    + `?fields=${fields}&since=${since}`
    + `&access_token=${accessToken}&limit=100`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.error(`[insights] FB API error: ${data.error.message}`);
    return;
  }

  const insights = loadInsights();
  const queue = loadQueue();

  const fbIdToPost = {};
  for (const post of queue.posts) {
    if (post.platform_post_ids && post.platform_post_ids.fb) {
      fbIdToPost[post.platform_post_ids.fb] = post;
    }
  }

  for (const fbPost of (data.data || [])) {
    const queuePost = fbIdToPost[fbPost.id];
    if (!queuePost) continue;

    const metrics = extractMetrics(
      (fbPost.insights && fbPost.insights.data) || []
    );
    insights.posts[queuePost.id] = {
      fb_post_id: fbPost.id,
      theme: queuePost.theme,
      posted_at: fbPost.created_time,
      metrics
    };
  }

  insights.theme_performance = computeThemePerformance(insights.posts);
  insights.last_fetched = new Date().toISOString();
  saveInsights(insights);
  console.log(
    `[insights] Updated: ${Object.keys(insights.posts).length} posts, `
    + `${Object.keys(insights.theme_performance).length} themes`
  );
}

function extractMetrics(insightsData) {
  const m = { reactions: 0, comments: 0, shares: 0, clicks: 0 };
  for (const metric of insightsData) {
    const val = metric.values && metric.values[0] && metric.values[0].value;
    if (!val) continue;
    switch (metric.name) {
      case 'post_reactions_by_type_total':
        m.reactions = typeof val === 'object'
          ? Object.values(val).reduce((a, b) => a + b, 0)
          : val;
        break;
      case 'post_comments': m.comments = val; break;
      case 'post_shares': m.shares = val; break;
      case 'post_clicks': m.clicks = val; break;
    }
  }
  return m;
}

function computeThemePerformance(posts) {
  const byTheme = {};
  for (const post of Object.values(posts)) {
    if (!byTheme[post.theme]) byTheme[post.theme] = [];
    const m = post.metrics;
    byTheme[post.theme].push({
      engagement: m.reactions + m.comments + m.shares + m.clicks,
      posted_at: post.posted_at
    });
  }

  const perf = {};
  for (const [theme, entries] of Object.entries(byTheme)) {
    entries.sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
    const total = entries.reduce((s, e) => s + e.engagement, 0);
    const avg = Math.round(total / entries.length);

    let trend = 'stable';
    if (entries.length >= 6) {
      const recentAvg = entries.slice(0, 5)
        .reduce((s, e) => s + e.engagement, 0) / 5;
      const priorCount = Math.min(entries.length - 5, 5);
      const priorAvg = entries.slice(5, 10)
        .reduce((s, e) => s + e.engagement, 0) / priorCount;
      if (recentAvg > priorAvg * 1.2) trend = 'up';
      else if (recentAvg < priorAvg * 0.8) trend = 'down';
    }

    perf[theme] = { avg_engagement: avg, post_count: entries.length, trend };
  }
  return perf;
}

function getTopThemes(limit) {
  limit = limit || 3;
  const insights = loadInsights();
  return Object.entries(insights.theme_performance)
    .sort((a, b) => b[1].avg_engagement - a[1].avg_engagement)
    .slice(0, limit)
    .map(([theme, data]) =>
      `${theme.replace(/_/g, ' ')} (avg ${data.avg_engagement}, trending ${data.trend})`
    );
}

module.exports = { fetchFBInsights, loadInsights, getTopThemes };
