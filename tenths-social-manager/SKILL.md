---
name: tenths-social-manager
description: Manage social media for tenths.racing on X/Twitter and Facebook via Discord. Use when generating draft social posts, reviewing content batches, approving or rejecting scheduled posts, posting to X and Facebook, checking post history, auto-publishing approved content, managing the content calendar, looking up or adding tracks/cars/tires to Supabase, researching racing data, or creating promo/trial links for Tenths Pro.
metadata: {"clawdbot":{"emoji":"🏁","os":["linux","darwin"]}}
---

# Tenths Social Manager

Generate, review, and publish social media content for tenths.racing on X/Twitter and Facebook. Twice weekly, the agent generates 2-3 draft posts (platform-native for both X and Facebook) using AI, posts them as rich embeds to Discord for review, and auto-publishes approved content at scheduled times. Facebook posts include auto-generated app screenshots. Facebook Insights analytics feed back into content generation to optimize themes. Also manages the Supabase racing database -- look up, research, and insert tracks, cars, and tires via Discord commands.

## When to Use

- Generating draft social posts or posting on-demand tweets
- Reviewing/approving queued posts via Discord reactions
- Checking upcoming schedule or past post history
- Looking up or adding tracks, cars, or tires in Supabase
- Creating promo/trial links for Tenths Pro subscriptions
- Troubleshooting failed X API posts

## Prerequisites

Credentials in tenths.racing Proton Pass vault, exported as env vars. Discord: `#tenths-social` in Build Useful (shared bot from `~/.agents/config/discord-bot.json`, auth via `authorized-users.json`). Repo: `~/Code/crew-chief`.

```bash
# X/Twitter OAuth 1.0a (required for posting)
export X_API_KEY="your-consumer-key"
export X_API_SECRET="your-consumer-secret"
export X_ACCESS_TOKEN="your-access-token"
export X_ACCESS_SECRET="your-access-token-secret"
# Supabase service role (from ~/Code/crew-chief/.env.local)
export SUPABASE_URL="https://ssoybleustqhracbvrho.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

```bash
# Facebook Page (Meta Graph API)
export FB_PAGE_ID="your-page-id"
export FB_PAGE_ACCESS_TOKEN="your-page-access-token"
export FB_APP_ID="your-app-id"
export FB_APP_SECRET="your-app-secret"
# Demo user for screenshots (Clerk auth)
export DEMO_USER_EMAIL="demo@tenths.racing"
export DEMO_USER_PASSWORD="your-demo-password"
```

## Data Files

### Config -- `~/.agents/data/tenths-social-config.json`

```json
{
  "schedule": { "generate_days": ["monday","thursday"], "generate_time": "08:00", "post_times": ["12:00","18:00"], "timezone": "America/New_York" },
  "platforms": {
    "x": { "enabled": true, "auto_post": true },
    "fb": { "enabled": true, "auto_post": true }
  },
  "content_themes": ["feature_announcement","racing_tip","setup_advice","community_poll","race_day_prompt","tech_explainer","product_highlight"],
  "screenshot_pages": {
    "setup_advice": "/setup",
    "tech_explainer": "/engine",
    "feature_announcement": "/dashboard",
    "racing_tip": "/calculators/gear-ratio",
    "product_highlight": "/calculators",
    "community_poll": null,
    "race_day_prompt": null
  },
  "brand": {
    "name": "Tenths", "tagline": "Every Tenth Matters.", "url": "https://tenths.racing", "color": "#FF8A00",
    "voice": "Technical but approachable. Talk like a fellow racer in the pits, not a marketing team. Short sentences. Use racing terminology naturally."
  }
}
```

### Queue -- `~/.agents/data/tenths-social-queue.json`

Each post has `id`, `status` (draft/quick-draft/approved/editing/rejected/posted/failed), `theme`, `content`, `scheduled_at`, `posted_at`, `failed_at`, `discord_message_id`, `platform_post_ids`.

```json
{ "posts": [{ "id": "POST-0001", "status": "draft", "theme": "racing_tip",
    "content": {
      "x": { "text": "Your cross-weight % matters more than...", "char_count": 234 },
      "fb": { "text": "Getting your cross-weight dialed in is the single biggest setup change you can make at a short track. Most racers chase springs and shocks, but nailing your cross-weight percentage first gives you a consistent baseline to tune from.", "char_count": 248, "hashtags": ["#shorttrackracing", "#setuptips"] }
    },
    "scheduled_at": null, "posted_at": null, "discord_message_id": null, "platform_post_ids": {} }] }
```

### Facebook Insights -- `~/.agents/data/tenths-fb-insights.json`

Engagement metrics per post and aggregated theme performance. Updated daily by cron.

```json
{
  "last_fetched": "2026-03-07T12:00:00Z",
  "posts": { "POST-0012": { "fb_post_id": "123456", "theme": "racing_tip", "metrics": { "reactions": 24, "comments": 5, "shares": 3, "clicks": 18 } } },
  "theme_performance": { "racing_tip": { "avg_engagement": 42, "post_count": 8, "trend": "up" } }
}
```

## Discord Commands

| Command | Description |
|---------|-------------|
| `!tenths generate` | Generate next batch of 2-3 draft posts |
| `!tenths generate <theme>` | Generate drafts for a specific theme |
| `!tenths quick <text>` | Quick draft for immediate posting after approval |
| `!tenths queue` | Show all pending and approved posts |
| `!tenths schedule` | Show upcoming auto-post schedule |
| `!tenths history [n]` | Show last N published posts (default: 5) |
| `!tenths post <id>` | Force-post an approved post immediately |
| `!tenths themes` | List available content themes |
| `!tenths stats` | Show post counts by theme |
| `!tenths lookup <type> <query>` | Search tracks/cars/tires in Supabase |
| `!tenths addtrack <name> [state]` | Research and add a track to Supabase |
| `!tenths addcar <year> <make> <model>` | Research and add a car to Supabase |
| `!tenths addtire <brand> <model>` | Research and add a tire to Supabase |
| `!tenths promo [days] [max_uses] [description]` | Create a promo link (default: 30-day trial) |
| `!tenths racenight [state]` | Discover tonight's races, generate personalized FB posts + promos |

## Command Handler

```javascript
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const CONFIG_PATH = path.join(process.env.HOME, '.agents', 'data', 'tenths-social-config.json');
const QUEUE_PATH = path.join(process.env.HOME, '.agents', 'data', 'tenths-social-queue.json');
const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');
const REPO_PATH = path.join(process.env.HOME, 'Code', 'crew-chief');
const { getTopThemes } = require('./insights');
const { captureScreenshots } = require('./screenshots');
const { handleRacenight } = require('./racenight');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'tenths-social' || message.author.bot) return;
  if (!message.content.startsWith('!tenths')) return;
  if (!isAuthorized(message.author.id)) return message.reply('Not authorized.');

  const args = message.content.split(/\s+/).slice(1);
  const sub = args[0] || 'help';

  switch (sub) {
    case 'generate':  await handleGenerate(message, args[1]); break;
    case 'quick':     await handleQuickPost(message, args.slice(1).join(' ')); break;
    case 'queue':     await handleQueue(message); break;
    case 'schedule':  await handleSchedule(message); break;
    case 'history':   await handleHistory(message, parseInt(args[1]) || 5); break;
    case 'post':      await handleForcePost(message, args[1]); break;
    case 'themes':    await handleThemes(message); break;
    case 'stats':     await handleStats(message); break;
    case 'lookup':    await handleLookup(message, args[1], args.slice(2).join(' ')); break;
    case 'addtrack':  await handleAddEntity(message, 'track', args.slice(1)); break;
    case 'addcar':    await handleAddEntity(message, 'car', args.slice(1)); break;
    case 'addtire':   await handleAddEntity(message, 'tire', args.slice(1)); break;
    case 'promo':     await handlePromo(message, args.slice(1)); break;
    case 'racenight': await handleRacenightCommand(message, args.slice(1)); break;
    default:          await message.reply('Commands: `generate`, `quick`, `queue`, `schedule`, `history`, `post`, `themes`, `stats`, `lookup`, `addtrack`, `addcar`, `addtire`, `promo`, `racenight`');
  }
});

async function handleRacenightCommand(message, args) {
  const stateOverride = args[0] || null; // e.g., "TX"
  await message.react('⏳');
  try {
    await handleRacenight(message, stateOverride);
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('🏁');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('❌');
    await message.reply(`Race night failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
  }
}

function isAuthorized(discordId) {
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return auth.authorized_users.some(u => u.discord_id === discordId);
  } catch { return false; }
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); }
  catch { return { posts: [] }; }
}

function saveQueue(queue) {
  const tmp = `/tmp/tenths-social-queue-${Date.now()}.json`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, QUEUE_PATH);
}
```

## Content Generation

Builds context from config, git changelog, racing season, and app features. Calls OpenClaw agent to generate 2-3 draft tweets, posts each as a rich embed with approve/edit/reject reactions.

```javascript
async function handleGenerate(message, theme) {
  await message.react('⏳');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const context = buildContentContext(config, theme);
  try {
    // Capture fresh screenshots before generating content
    try { await captureScreenshots(); } catch (err) {
      console.warn('[tenths-social] Screenshot capture failed:', err.message);
    }
    const drafts = await generateDrafts(context, theme);
    const queue = loadQueue();
    let nextId = queue.posts.length + 1;
    for (const draft of drafts) {
      const post = { id: `POST-${String(nextId++).padStart(4, '0')}`, created_at: new Date().toISOString(),
        status: 'draft', theme: draft.theme, content: draft.content,
        scheduled_at: null, posted_at: null, discord_message_id: null, platform_post_ids: {} };
      const sent = await message.channel.send({ embeds: [buildDraftEmbed(post)] });
      await sent.react('✅'); await sent.react('✏️'); await sent.react('❌');
      post.discord_message_id = sent.id; queue.posts.push(post);
    }
    saveQueue(queue); await message.reactions.cache.get('⏳')?.remove(); await message.react('🏁');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove(); await message.react('❌');
    await message.reply(`Generation failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
  }
}

function buildContentContext(config, theme) {
  let changelog = '';
  try { changelog = execSync('git log --oneline --since="14 days ago" --no-merges',
    { cwd: REPO_PATH, encoding: 'utf8', timeout: 10000 }).trim(); } catch { changelog = 'No recent commits'; }
  const m = new Date().getMonth();
  const topThemes = getTopThemes(3);
  return { brand: config.brand, changelog, racingSeason: (m >= 3 && m <= 9) ? 'in-season' : 'off-season',
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    requestedTheme: theme || null, availableThemes: config.content_themes,
    features: ['Setup calculator', 'Engine simulator', 'Corner weight calc', 'Gear ratio calc',
      'Diagnostic troubleshooter', 'Session logger', 'Division rulebooks (2026)', 'Tech inspection checklists'],
    divisions: ['Ironman F8', 'Old School F8', 'Street Stock', 'Juicebox', 'Compacts'],
    targetAudience: 'Short-track racers who wrench their own cars.',
    fbTopThemes: topThemes };
}

async function generateDrafts(context, theme) {
  const fbInsightLine = context.fbTopThemes.length
    ? `\nFB TOP THEMES: ${context.fbTopThemes.join('; ')}. Lean toward these but maintain variety.`
    : '';

  const prompt = `Generate 2-3 social posts for Tenths racing app (tenths.racing).
VOICE: ${context.brand.voice} | TAGLINE: ${context.brand.tagline}
SEASON: ${context.racingSeason} | DAY: ${context.dayOfWeek}
${context.requestedTheme ? `THEME: ${context.requestedTheme}` : `THEMES: ${context.availableThemes.join(', ')}`}
CHANGELOG: ${context.changelog}
FEATURES: ${context.features.join('; ')}
DIVISIONS: ${context.divisions.join(', ')} | AUDIENCE: ${context.targetAudience}${fbInsightLine}

Generate for TWO platforms per post:
- x: Punchy tweet, max 280 chars
- fb: Facebook post, 2-4 descriptive sentences (~500 chars), include hashtags and call-to-action to tenths.racing

Return JSON array: [{ theme, content: { x: { text, char_count }, fb: { text, char_count, hashtags: [] } } }]`;

  const escaped = prompt.replace(/'/g, "'\\''");
  try {
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --json --thinking medium --timeout 120`,
      { encoding: 'utf8', timeout: 150000, maxBuffer: 5 * 1024 * 1024 });
    const envelope = JSON.parse(stdout);
    if (!envelope.success) throw new Error(envelope.error || 'OpenClaw agent failed');
    const text = envelope.result || envelope.content || envelope.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn('[tenths-social] OpenClaw failed, fallback:', err.message);
    return generateFallbackDrafts(context);
  }
}
```

## Quick Post, Embeds, and Reaction Handler

`!tenths quick <text>` creates a `quick-draft` post with preview embed. On approval, posts to X immediately (no scheduling). Regular `draft` posts get scheduled on approval.

```javascript
async function handleQuickPost(message, text) {
  if (!text?.trim()) return message.reply('Usage: `!tenths quick Your tweet text here`');
  text = text.trim();
  if (text.length > 280) return message.reply(`${text.length}/280 chars. Shorten by ${text.length - 280}.`);
  const queue = loadQueue();
  const post = { id: `POST-${String(queue.posts.length + 1).padStart(4, '0')}`,
    created_at: new Date().toISOString(), status: 'quick-draft', theme: 'on_demand',
    content: {
      x: { text, char_count: text.length },
      fb: { text, char_count: text.length, hashtags: [] }
    },
    scheduled_at: null, posted_at: null, discord_message_id: null, platform_post_ids: {} };
  const embed = new EmbedBuilder().setTitle('⚡ Quick Post Preview').setColor(0xFF8A00)
    .addFields(
      { name: '𝕏 Post', value: `\`\`\`\n${text}\n\`\`\`\n${text.length}/280 chars` },
      { name: '📘 Facebook Post', value: `\`\`\`\n${text}\n\`\`\`\n${text.length} chars` }
    )
    .setTimestamp().setFooter({ text: `${post.id} · ✅ post now · ❌ discard` });
  const sent = await message.channel.send({ embeds: [embed] });
  await sent.react('✅'); await sent.react('❌');
  post.discord_message_id = sent.id; queue.posts.push(post); saveQueue(queue);
}

function buildDraftEmbed(post) {
  const embed = new EmbedBuilder()
    .setTitle(`🏁 Draft: ${post.theme.replace(/_/g, ' ').toUpperCase()}`).setColor(0xFF8A00)
    .addFields({ name: '𝕏 Post', value: `\`\`\`\n${post.content.x.text}\n\`\`\`\n${post.content.x.char_count}/280 chars` });

  if (post.content.fb) {
    const fbText = post.content.fb.hashtags && post.content.fb.hashtags.length
      ? `${post.content.fb.text}\n${post.content.fb.hashtags.join(' ')}`
      : post.content.fb.text;
    embed.addFields({ name: '📘 Facebook Post', value: `\`\`\`\n${fbText}\n\`\`\`\n${post.content.fb.char_count} chars` });
  }

  return embed.setTimestamp().setFooter({ text: `${post.id} · React: ✅ approve · ✏️ edit · ❌ reject` });
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.message.channel.name !== 'tenths-social' || !isAuthorized(user.id)) return;
  const emoji = reaction.emoji.name, ch = reaction.message.channel;

  // Pending data inserts (addtrack/addcar/addtire approvals)
  const pi = pendingInserts.get(reaction.message.id);
  if (pi) {
    if (emoji === '✅') await executePendingInsert(pi, ch);
    else if (emoji === '❌') await ch.send(`❌ ${pi.type} insert discarded.`);
    pendingInserts.delete(reaction.message.id); return;
  }

  // Post queue reactions (draft/quick-draft/failed)
  const queue = loadQueue();
  const post = queue.posts.find(p => p.discord_message_id === reaction.message.id);
  if (!post || !['draft', 'quick-draft', 'failed'].includes(post.status)) return;

  // Retry failed posts — ✅ re-queues for next publish cycle
  if (post.status === 'failed' && emoji === '✅') {
    post.status = 'approved'; post.scheduled_at = getNextPostTime();
    post.platform_post_ids = {}; delete post.failed_at;
    saveQueue(queue);
    await ch.send({ embeds: [new EmbedBuilder().setTitle(`🔄 Retrying: ${post.id}`).setColor(0xFF8A00)
      .setDescription(`Re-scheduled for ${post.scheduled_at}`).setTimestamp()] });
    return;
  }

  if (emoji === '✅') {
    if (post.status === 'quick-draft') {
      try {
        const { results, errors, allFailed } = await publishToAllPlatforms(post);
        post.platform_post_ids = results;
        post.status = allFailed ? 'failed' : 'posted';
        post.posted_at = allFailed ? undefined : new Date().toISOString();
        if (allFailed) post.failed_at = new Date().toISOString();
        saveQueue(queue);
        const links = [];
        if (results.x && !results.x.error) links.push(`𝕏: https://x.com/TenthsRacing/status/${results.x}`);
        if (results.fb && !results.fb.error) links.push('📘 FB: posted');
        const embed = new EmbedBuilder().setTimestamp();
        if (allFailed) {
          embed.setTitle(`❌ Post Failed: ${post.id}`).setColor(0xe74c3c)
            .setDescription(errors.join('\n'));
        } else {
          embed.setTitle(`🏁 Posted: ${post.id}`).setColor(0x2ecc71)
            .setDescription(links.join('\n') + (errors.length ? `\n⚠️ Partial: ${errors.join(', ')}` : ''));
        }
        await ch.send({ embeds: [embed] });
      } catch (err) {
        post.platform_post_ids = { x: { error: err.message } }; saveQueue(queue);
        await ch.send(`❌ Post failed: \`${err.message.slice(0, 200)}\``);
      }
    } else {
      post.status = 'approved'; post.scheduled_at = getNextPostTime(); saveQueue(queue);
      await ch.send({ embeds: [new EmbedBuilder().setTitle(`✅ Approved: ${post.id}`).setColor(0x2ecc71)
        .setDescription(`Scheduled for ${post.scheduled_at}`).setTimestamp()] });
    }
  }
  if (emoji === '❌') { post.status = 'rejected'; saveQueue(queue); await ch.send(`❌ ${post.id} rejected.`); }
  if (emoji === '✏️' && post.status === 'draft') {
    post.status = 'editing'; saveQueue(queue);
    await ch.send(`✏️ ${post.id} editing. Reply: \`x: new tweet text\``);
  }
});
```

## Platform Publishing

```javascript
const { TwitterApi } = require('twitter-api-v2');
const { postToFacebook } = require('./publisher-fb');

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET });

async function postToX(post) {
  const { data } = await xClient.v2.tweet(post.content.x.text);
  return data.id;
}

async function publishToAllPlatforms(post) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const results = {};
  const errors = [];

  if (config.platforms.x && config.platforms.x.enabled) {
    try { results.x = await postToX(post); }
    catch (err) { results.x = { error: err.message }; errors.push(`X: ${err.message}`); }
  }

  if (config.platforms.fb && config.platforms.fb.enabled && post.content.fb) {
    try { results.fb = await postToFacebook(post); }
    catch (err) { results.fb = { error: err.message }; errors.push(`FB: ${err.message}`); }
  }

  return { results, errors,
    allFailed: errors.length > 0 && Object.keys(results).every(k => results[k] && results[k].error) };
}
```

## App Screenshots

Playwright captures screenshots of tenths.racing feature pages for Facebook posts. Runs before each content generation batch.

```javascript
const { captureScreenshots, getScreenshotPath, THEME_PAGES } = require('./screenshots');
// captureScreenshots() -- logs in as demo user, navigates each theme page, saves 1200x630 PNGs
// getScreenshotPath(theme) -- returns file path if screenshot exists, null otherwise
// See screenshots.js for full implementation
```

## Facebook Insights

Daily cron fetches engagement metrics from the Facebook Page and computes per-theme performance.

```javascript
const { fetchFBInsights, getTopThemes } = require('./insights');
// fetchFBInsights() -- pulls last 30 days of post metrics, computes theme_performance
// getTopThemes(3) -- returns ["racing tip (avg 42, trending up)", ...] for generation prompt
// Data stored in ~/.agents/data/tenths-fb-insights.json
// See insights.js for full implementation
```

## Scheduling and Auto-Publish

```javascript
// Run via setInterval(checkAndPublish, 15*60*1000) or cron
async function checkAndPublish() {
  const queue = loadQueue(), now = new Date();
  const due = queue.posts.filter(p => p.status === 'approved' && p.scheduled_at && new Date(p.scheduled_at) <= now);
  let changed = false;
  for (const post of due) {
    const { results, errors, allFailed } = await publishToAllPlatforms(post);
    post.platform_post_ids = results;
    if (allFailed) {
      post.status = 'failed'; post.failed_at = now.toISOString();
      console.error(`[tenths-social] Post ${post.id} failed:`, errors.join('; '));
    } else {
      post.status = 'posted'; post.posted_at = now.toISOString();
      if (errors.length) console.warn(`[tenths-social] Post ${post.id} partial:`, errors.join('; '));
    }
    changed = true;
  }
  if (changed) saveQueue(queue);
}
```

```bash
# Cron: generate Mon/Thu 8AM ET, publish every 15min, insights daily 6AM ET
0 12 * * 1,4 cd ~/.agents && openclaw agent --message "Run !tenths generate in #tenths-social" --timeout 120 2>&1 >> ~/logs/tenths-social.log
*/15 * * * * cd ~/.agents && node -e "require('./skills/tenths-social-manager/publisher.js').checkAndPublish()" 2>&1 >> ~/logs/tenths-social.log
0 10 * * * cd ~/.agents && node -e "require('./skills/tenths-social-manager/insights.js').fetchFBInsights()" 2>&1 >> ~/logs/tenths-social.log
```

## Queue and History

```javascript
async function handleQueue(message) {
  const pending = loadQueue().posts.filter(p => ['draft','quick-draft','approved','editing','failed'].includes(p.status));
  if (!pending.length) return message.reply('Queue empty. Run `!tenths generate`.');
  const icons = { draft: '📝', 'quick-draft': '⚡', approved: '✅', editing: '✏️', failed: '❌' };
  await message.channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Queue').setColor(0xFF8A00)
    .setDescription(pending.map(p => `${icons[p.status]} **${p.id}** — ${p.theme.replace(/_/g,' ')}`).join('\n'))] });
}

async function handleHistory(message, count) {
  const posted = loadQueue().posts.filter(p => p.status === 'posted')
    .sort((a,b) => new Date(b.posted_at) - new Date(a.posted_at)).slice(0, count);
  if (!posted.length) return message.reply('No posts yet.');
  await message.channel.send({ embeds: [new EmbedBuilder().setTitle('🏁 Recent Posts').setColor(0xFF8A00)
    .setDescription(posted.map((p,i) => {
      const xOk = p.platform_post_ids?.x && !p.platform_post_ids.x.error;
      const fbOk = p.platform_post_ids?.fb && !p.platform_post_ids.fb.error;
      return `**${i+1}.** ${new Date(p.posted_at).toLocaleDateString()} — ${p.theme.replace(/_/g,' ')} ${xOk?'𝕏 ✓':'𝕏 ✗'} ${fbOk?'📘 ✓':'📘 ✗'}`;
    }).join('\n'))] });
}
```

## Promo Link Generator

Creates a promo code in the existing `promotions` Supabase table and returns a shareable link. The app already has a promo landing page at `tenths.racing/promo/CODE` that handles signup, Stripe checkout with trial, and redemption tracking.

```javascript
async function handlePromo(message, args) {
  // Parse: !tenths promo [days] [max_uses] [description...]
  // Defaults: 30 days, unlimited uses, no description
  let trialDays = 30, maxUses = null, description = null;

  if (args.length > 0 && !isNaN(parseInt(args[0]))) {
    trialDays = parseInt(args[0]);
    if (trialDays < 1 || trialDays > 90) return message.reply('Trial days must be 1-90.');
    args = args.slice(1);
  }
  if (args.length > 0 && !isNaN(parseInt(args[0]))) {
    maxUses = parseInt(args[0]);
    if (maxUses < 1) return message.reply('Max uses must be at least 1.');
    args = args.slice(1);
  }
  if (args.length > 0) description = args.join(' ');

  // Generate a unique code: TENTHS-XXXX
  const code = 'TENTHS-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setDate(validUntil.getDate() + 90); // promo link valid for 90 days

  try {
    const { error } = await supabase.from('promotions').insert({
      code,
      trial_days: trialDays,
      description,
      is_active: true,
      valid_from: now.toISOString(),
      valid_until: validUntil.toISOString(),
      max_uses: maxUses,
      use_count: 0
    });
    if (error) throw error;

    const promoUrl = `https://tenths.racing/promo/${code}`;
    const embed = new EmbedBuilder()
      .setTitle('🎟️ Promo Link Created')
      .setColor(0x00E676)
      .addFields(
        { name: 'Link', value: promoUrl },
        { name: 'Code', value: `\`${code}\``, inline: true },
        { name: 'Trial', value: `${trialDays} days free`, inline: true },
        { name: 'Max Uses', value: maxUses ? `${maxUses}` : 'Unlimited', inline: true },
        { name: 'Expires', value: validUntil.toLocaleDateString(), inline: true }
      )
      .setTimestamp();
    if (description) embed.addFields({ name: 'Description', value: description });
    embed.setFooter({ text: 'Share this link -- users sign up, enter payment, and get the trial automatically.' });

    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    await message.reply(`Promo creation failed: \`${err.message.slice(0, 300)}\``);
  }
}
```

## Supabase Data Management

### Tires Table Migration

```sql
CREATE TABLE public.tires (
  id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, label TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('dirt', 'asphalt', 'both')),
  pressure_range JSONB NOT NULL, pressure_by_track_surface JSONB,
  compound_type TEXT, notes TEXT, active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.tires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tires_read" ON public.tires FOR SELECT USING (true);
CREATE INDEX idx_tires_brand ON public.tires(brand);
CREATE INDEX idx_tires_surface ON public.tires(surface);
```

### Lookup Command

Unified search across tracks, cars, tires with type-specific columns and formatting.

```javascript
const LOOKUP = {
  track: { table: 'tracks', cols: ['name','location','state'], order: 'name',
    fmt: t => `**${t.name}** — ${t.location}, ${t.state}\n${t.length} mi · ${t.surface} · ${t.banking}°` },
  car: { table: 'cars', cols: ['name','make','model'], order: 'name',
    fmt: c => `**${c.name}** — ${c.year} ${c.make} ${c.model}\nDivisions: ${(c.eligible_divisions||[]).join(', ')}` },
  tire: { table: 'tires', cols: ['brand','model','label'], order: 'brand',
    fmt: t => `**${t.label}** — ${t.brand} ${t.model}\n${t.surface} · ${t.compound_type||'N/A'}` }
};

async function handleLookup(message, type, query) {
  if (!type || !query) return message.reply('Usage: `!tenths lookup <track|car|tire> <query>`');
  const cfg = LOOKUP[type.toLowerCase()];
  if (!cfg) return message.reply('Type must be `track`, `car`, or `tire`.');
  await message.react('🔍');
  try {
    const { data, error } = await supabase.from(cfg.table).select('*')
      .or(cfg.cols.map(c => `${c}.ilike.%${query}%`).join(',')).eq('active', true).order(cfg.order).limit(10);
    if (error) throw error;
    if (!data?.length) return message.reply(`No ${type}s found. Use \`!tenths add${type}\` to add.`);
    await message.channel.send({ embeds: [new EmbedBuilder()
      .setTitle(`🔍 ${type} Results: "${query}"`).setColor(0xFF8A00)
      .setDescription(data.map(cfg.fmt).join('\n\n')).setTimestamp()] });
  } catch (err) { await message.reply(`Lookup failed: \`${err.message.slice(0, 300)}\``); }
}
```

### Add Entity Command (Unified)

All three add commands follow the same pattern: validate args, check Supabase for duplicates, research via AI, preview embed, approve/reject via reactions. Type-specific config (parsing, dupe check, embed fields) is in `ADD_CONFIG`.

```javascript
const pendingInserts = new Map();

// ADD_CONFIG: each type defines parseArgs, checkDupe (returns supabase query), dupeMsg, buildEmbed (returns fields[]), title
const ADD_CONFIG = {
  track: { usage: '`!tenths addtrack <name> [state]`', minArgs: 1,
    parseArgs: (args) => { const l = args[args.length-1]; const s = l.length===2 ? l.toUpperCase() : null;
      return { query: s ? args.slice(0,-1).join(' ') : args.join(' '), stateHint: s }; },
    checkDupe: (q) => supabase.from('tracks').select('*').ilike('name', `%${q.query}%`).eq('active', true).limit(1),
    dupeMsg: (t) => `Already exists: **${t.name}** (${t.location}, ${t.state})`,
    buildEmbed: (d) => [
      { name: 'Location', value: `${d.location}, ${d.state}`, inline: true },
      { name: 'Length', value: `${d.length} mi`, inline: true }, { name: 'Surface', value: d.surface, inline: true },
      { name: 'Banking', value: `${d.banking}°`, inline: true }, { name: 'Shape', value: d.shape, inline: true },
      { name: 'Elevation', value: `${d.elevation} ft`, inline: true }, ...(d.notes ? [{ name: 'Notes', value: d.notes }] : [])],
    title: (d) => `🏟️ Track: ${d.name}` },
  car: { usage: '`!tenths addcar <year> <make> <model>`', minArgs: 3,
    parseArgs: (args) => { const y = parseInt(args[0]);
      if (isNaN(y)||y<1960||y>2030) throw new Error('Year must be 1960-2030.');
      return { query: args.join(' '), make: args[1], model: args.slice(2).join(' ') }; },
    checkDupe: (q) => supabase.from('cars').select('*').ilike('make', `%${q.make}%`).ilike('model', `%${q.model}%`).eq('active', true).limit(1),
    dupeMsg: (c) => `Already exists: **${c.name}** (${c.year} ${c.make} ${c.model})`,
    buildEmbed: (d) => { const e = d.engine||{}; return [
      { name: 'Year/Make/Model', value: `${d.year} ${d.make} ${d.model}`, inline: true },
      { name: 'Weight', value: `${d.weight?.base||'TBD'} lbs`, inline: true },
      { name: 'Wheelbase', value: `${d.wheelbase}"`, inline: true },
      { name: 'Engine', value: `${e.displacement||'?'} ci ${e.block||''}`.trim(), inline: true },
      { name: 'Suspension', value: `F: ${d.suspension_front?.type||'TBD'} / R: ${d.suspension_rear?.type||'TBD'}`, inline: true },
      { name: 'Divisions', value: (d.eligible_divisions||[]).join(', ')||'TBD' }]; },
    title: (d) => `🏎️ Car: ${d.name}` },
  tire: { usage: '`!tenths addtire <brand> <model>`', minArgs: 2,
    parseArgs: (args) => ({ query: args.join(' '), brand: args[0], model: args.slice(1).join(' ') }),
    checkDupe: (q) => supabase.from('tires').select('*').ilike('brand', `%${q.brand}%`).ilike('model', `%${q.model}%`).eq('active', true).limit(1),
    dupeMsg: (t) => `Already exists: **${t.label}** (${t.brand} ${t.model})`,
    buildEmbed: (d) => { const pr = d.pressure_range||{}; return [
      { name: 'Brand/Model', value: `${d.brand} ${d.model}`, inline: true },
      { name: 'Surface', value: d.surface, inline: true }, { name: 'Compound', value: d.compound_type||'N/A', inline: true },
      { name: 'Pressure (F/R)', value: pr.front ? `${pr.front[0]}-${pr.front[1]} / ${pr.rear[0]}-${pr.rear[1]} psi` : 'TBD', inline: true }]; },
    title: (d) => `🛞 Tire: ${d.label}` }
};

async function handleAddEntity(message, type, args) {
  const cfg = ADD_CONFIG[type];
  if (args.length < cfg.minArgs) return message.reply(`Usage: ${cfg.usage}`);
  let parsed;
  try { parsed = cfg.parseArgs(args); } catch (e) { return message.reply(e.message); }
  await message.react('⏳');
  const { data: existing } = await cfg.checkDupe(parsed);
  if (existing?.length) return message.reply(cfg.dupeMsg(existing[0]));
  try {
    const entityData = await researchEntity(type, parsed.query, parsed.stateHint);
    const embed = new EmbedBuilder().setTitle(cfg.title(entityData)).setColor(0xFF8A00)
      .addFields(...cfg.buildEmbed(entityData))
      .setFooter({ text: 'React: ✅ add · ❌ discard' }).setTimestamp();
    const sent = await message.channel.send({ embeds: [embed] });
    await sent.react('✅'); await sent.react('❌');
    pendingInserts.set(sent.id, { type, data: entityData });
  } catch (err) { await message.reply(`Research failed: \`${err.message.slice(0, 300)}\``); }
}

async function executePendingInsert(pending, channel) {
  const table = { track: 'tracks', car: 'cars', tire: 'tires' }[pending.type];
  try {
    const { error } = await supabase.from(table).upsert(pending.data, { onConflict: 'id' });
    if (error) throw error;
    await channel.send({ embeds: [new EmbedBuilder()
      .setTitle(`✅ ${pending.type} Added`).setColor(0x2ecc71)
      .setDescription(`**${pending.data.name||pending.data.label}** inserted into \`${table}\`.`).setTimestamp()] });
  } catch (err) { await channel.send(`❌ Insert failed: \`${err.message.slice(0, 300)}\``); }
}
```

### AI Entity Research

Shared function using OpenClaw agent to research tracks, cars, and tires. Returns structured JSON matching the Supabase table schema.

```javascript
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function researchEntity(type, query, stateHint) {
  const schemas = {
    track: '{ id, name, location, state, length (miles), surface (dirt|asphalt|concrete|mixed), surface_details, banking (degrees), shape, elevation (ft), notes, active }',
    car: '{ id, name, year, make, model, eligible_divisions[], engine_family_id, weight: {base}, wheelbase, track_width_front, track_width_rear, suspension_front: {type}, suspension_rear: {type}, engine: {displacement, block, heads, cam, carb, compression}, notes, active }',
    tire: '{ id, brand, model, label, surface (dirt|asphalt|both), pressure_range: {front: [min,max], rear: [min,max]}, pressure_by_track_surface, compound_type (soft|medium|hard|street), notes, active }'
  };
  const sources = {
    track: 'MyRacePass, Racing-Reference, DirtTrackDigest, track official websites',
    car: 'Racing forums, manufacturer specs, IMCA/USRA rulebooks, short-track division rules',
    tire: 'Hoosier Racing Tire catalog, American Racer specs, TCT tire datasheets'
  };

  const prompt = `Research this ${type} for short-track stock car racing. Return ONLY JSON.
QUERY: ${query}${stateHint ? ` (${stateHint})` : ''}
Sources: ${sources[type]}
Schema: ${schemas[type]}
Divisions: ironman-f8, old-school-f8, street-stock, compacts, juicebox. Return ONLY JSON.`;

  const escaped = prompt.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `openclaw agent --message '${escaped}' --json --thinking medium --timeout 120`,
    { encoding: 'utf8', timeout: 150000, maxBuffer: 5 * 1024 * 1024 }
  );
  const envelope = JSON.parse(stdout);
  if (!envelope.success) throw new Error(envelope.error || 'Research failed');

  const text = envelope.result || envelope.content || envelope.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object in research response');
  const data = JSON.parse(jsonMatch[0]);
  if (!data.id) data.id = slugify(data.name || data.label || query);
  return data;
}
```

## Platform Setup

X: developer.x.com -> Console -> New app -> Read+Write permissions -> Generate all 4 OAuth 1.0a keys.

Facebook: developers.facebook.com -> Create App -> Add Facebook Login + Pages API products -> Create "Tenths Racing" Page -> Graph API Explorer -> Get Page Access Token with pages_manage_posts, pages_read_engagement -> Exchange for long-lived token. Set profile pic and cover photo from crew-chief/public/fb-profile.png and fb-banner.png.

## Troubleshooting

```bash
# X 403 "Unsupported Authentication" -> posting requires OAuth 1.0a (all 4 keys), not Bearer token.
# X 403 "Forbidden" -> app permissions Read-only. Change to Read+Write, regenerate tokens.
# Bot not responding -> verify MessageContent intent ON in Discord Developer Portal.
# Channel mismatch -> handler filters on channel.name === 'tenths-social' (exact match).
# twitter-api-v2 not found -> npm install twitter-api-v2
# @supabase/supabase-js not found -> npm install @supabase/supabase-js
# Supabase insert 403 -> check SUPABASE_SERVICE_ROLE_KEY is set (anon key is read-only).
# Supabase "relation tires does not exist" -> run the tires migration SQL first.
# Research returns bad data -> OpenClaw may hallucinate specs. Always review before approving.
# FB "OAuthException" -> Page Access Token expired. Run refreshPageToken() or regenerate in Graph Explorer.
# FB "Unsupported post request" -> check FB_PAGE_ID is the Page ID, not the App ID.
# FB photo upload fails -> ensure formdata-node is installed: npm install formdata-node
# Screenshots blank/login page -> DEMO_USER_EMAIL/PASSWORD wrong or Clerk login flow changed.
# Playwright not found -> npm install playwright && npx playwright install chromium
# Screenshots stale -> captureScreenshots() runs before each generate. Check logs for errors.
# FB insights empty -> Page needs >= 100 followers for some metrics. Basic metrics work immediately.
```

## Tips

- Dry-preview `!tenths generate` before first real batch to verify brand voice.
- X free tier: 1,500 tweets/month (~20/month at 3-5 posts/week).
- Use `!tenths generate racing_tip` Fridays before race night; `!tenths quick` for race-night reactions.
- AI entity research is best-effort. Always verify specs against official sources before approving.
- Seed tires table via `!tenths addtire` for each compound in `tires.ts`. Use `!tenths lookup` first to avoid dupes.
- `!tenths promo` defaults to 30 days free, unlimited uses. Add args for custom trials: `!tenths promo 14 50 Race day special`.
- Facebook posts include screenshots for visual themes (setup_advice, tech_explainer, etc). Text-only for polls and race-day prompts.
- FB insights drive content themes after ~2 weeks of data. Initial posts use even theme distribution.
- Page Access Tokens expire ~60 days. Set a calendar reminder or use refreshPageToken() in publisher-fb.js.
- Dependencies: playwright, formdata-node. Install with: npm install playwright formdata-node && npx playwright install chromium
- Multi-platform expansion: X and Facebook are live. Add more platforms by extending publishToAllPlatforms() and the content generation prompt.
