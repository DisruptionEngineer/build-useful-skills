const { EmbedBuilder } = require('discord.js');
const { loadRacenightConfig } = require('./racenight-config');
const { scrapeMyRacePass } = require('./scraper-myracepass');
const { enrichTracks } = require('./track-enrichment');
const { generateTip } = require('./tip-generator');
const { captureRacenightScreenshots, cleanupOldScreenshots, getScreenshotRoute } = require('./racenight-screenshots');
const { createRacenightPromo } = require('./racenight-promo');
const { generateRacenightPost } = require('./racenight-post-generator');
const { postToFacebook } = require('./publisher-fb');
const screenshots = require('./screenshots');

const REACTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const REACTION_APPROVE = '\u2705'; // check mark
const REACTION_EDIT = '\u270F\uFE0F'; // pencil
const REACTION_SKIP = '\u274C'; // cross mark
const TRACK_REACTIONS = [REACTION_APPROVE, REACTION_EDIT, REACTION_SKIP];
const SUMMARY_REACTIONS = [REACTION_APPROVE, REACTION_SKIP];
const COLOR_ACTIVE = 0xFF8A00;
const COLOR_ERROR = 0xFF0000;
const COLOR_WARNING = 0xFFAA00;
const COLOR_DONE = 0x00FF00;

// Simple mutex to prevent concurrent monkey-patching of screenshots.getScreenshotPath
let publishLock = Promise.resolve();

/**
 * Main racenight orchestrator.
 * Called by: !tenths racenight [optional state]
 */
async function handleRacenight(message, stateOverride) {
  const config = loadRacenightConfig();

  cleanupOldScreenshots(config.screenshot_cleanup_days || 7);

  // Step 1: Discovery
  const regionLabel = stateOverride || config.regions.join(', ');
  const statusMsg = await message.channel.send({
    embeds: [buildEmbed(
      'Race Night Discovery',
      `Searching MyRacePass for tonight's races...\n**Regions:** ${regionLabel}\n**Divisions:** ${config.divisions.join(', ')}`,
      COLOR_ACTIVE
    )]
  });

  let result;
  try {
    result = await scrapeMyRacePass(config, stateOverride);
  } catch (err) {
    await statusMsg.edit({
      embeds: [buildEmbed('Scraping Failed', `MyRacePass scrape error: ${err.message}`, COLOR_ERROR)]
    });
    return;
  }

  if (!result.structured || !result.tracks || result.tracks.length === 0) {
    const description = result.structured
      ? 'No matching tracks found racing tonight in your configured regions/divisions.'
      : 'Could not parse MyRacePass page structure. Selectors may need updating.';
    await statusMsg.edit({
      embeds: [buildEmbed('Race Night Discovery', description, COLOR_WARNING)]
    });
    return;
  }

  const tracks = result.tracks;
  await statusMsg.edit({
    embeds: [buildEmbed(
      'Race Night Discovery',
      `Found **${tracks.length}** tracks racing tonight. Enriching data & generating posts...`,
      COLOR_ACTIVE
    )]
  });

  // Step 2: Enrich tracks
  const enriched = await enrichTracks(tracks);

  // Step 3: Generate tips
  for (const track of enriched) {
    track.tip = await generateTip(track);
  }

  // Step 4: Capture screenshots
  const screenshotMap = await captureRacenightScreenshots(enriched, config);

  // Step 5: Generate post content and attach metadata
  const today = new Date();
  const mmdd = String(today.getMonth() + 1).padStart(2, '0')
    + String(today.getDate()).padStart(2, '0');

  for (const track of enriched) {
    const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
    track.promo_code = `TENTHS-${abbrev}-${mmdd}`;
    track.promo_url = `https://tenths.racing/promo/${track.promo_code}`;
    track.post_text = await generateRacenightPost(track, track.tip, track.promo_code);
    track.screenshot_path = screenshotMap[abbrev] || null;
    track.status = 'pending'; // pending | approved | skipped
  }

  // Step 6: Post Discord embeds for each track
  const trackMessages = [];
  for (const track of enriched) {
    const embed = buildTrackEmbed(track, config);
    const sent = await message.channel.send({ embeds: [embed] });
    for (const emoji of TRACK_REACTIONS) {
      await sent.react(emoji);
    }
    trackMessages.push({ message: sent, track });
  }

  // Step 7: Summary embed with batch controls
  const summaryMsg = await message.channel.send({
    embeds: [buildSummaryEmbed(enriched.length, 0, 0)]
  });
  for (const emoji of SUMMARY_REACTIONS) {
    await summaryMsg.react(emoji);
  }

  // Step 8: Set up reaction collectors
  setupReactionHandlers(trackMessages, summaryMsg, config, message.channel);
}

/**
 * Build a track-specific Discord embed with all race night details.
 */
function buildTrackEmbed(track, config) {
  const { label } = getScreenshotRoute(track);
  const weatherLine = track.weather
    ? `${track.weather.temp_f}\u00B0F | ${track.weather.humidity}% humidity | Wind ${track.weather.wind_speed_mph} mph | ${track.weather.precip_chance}% rain`
    : 'Weather data unavailable';

  const postPreview = track.post_text.length > 1024
    ? track.post_text.substring(0, 1021) + '...'
    : track.post_text;

  return new EmbedBuilder()
    .setTitle(`RACE NIGHT: ${track.name}`)
    .setColor(COLOR_ACTIVE)
    .addFields(
      {
        name: 'Track Info',
        value: `${track.location || track.state || 'USA'} | ${track.length || '?'} | ${track.surface || '?'} | ${track.banking || '?'}`,
        inline: false
      },
      {
        name: 'Tonight',
        value: (track.divisions_tonight || []).join(', ') || 'Various classes',
        inline: true
      },
      {
        name: 'Weather',
        value: weatherLine,
        inline: true
      },
      {
        name: 'Facebook Post',
        value: postPreview,
        inline: false
      },
      {
        name: 'Tip',
        value: track.tip,
        inline: false
      },
      {
        name: 'Promo',
        value: `\`${track.promo_code}\` (0/${config.promo_max_uses} used)\n${track.promo_url}\nExpires: 6:00 AM ET tomorrow`,
        inline: true
      },
      {
        name: 'Screenshot',
        value: track.screenshot_path ? `${label}` : 'None',
        inline: true
      },
      {
        name: 'FB Tag',
        value: track.facebook_page_url || 'No FB page found',
        inline: true
      }
    )
    .setFooter({ text: 'React: Approve | Edit | Skip' })
    .setTimestamp();
}

/**
 * Build the summary embed showing overall approval progress.
 */
function buildSummaryEmbed(total, approved, skipped) {
  const pending = total - approved - skipped;
  const color = pending === 0 ? COLOR_DONE : COLOR_ACTIVE;
  return new EmbedBuilder()
    .setTitle('Race Night Summary')
    .setDescription(`${total} tracks found | ${approved} approved | ${skipped} skipped | ${pending} pending`)
    .setColor(color)
    .setFooter({ text: 'React: Approve ALL | Cancel ALL' })
    .setTimestamp();
}

/**
 * Build a simple embed with title, description, and color.
 */
function buildEmbed(title, description, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

/**
 * Set up Discord reaction collectors for per-track and batch approval.
 */
function setupReactionHandlers(trackMessages, summaryMsg, config, channel) {
  let approved = 0;
  let skipped = 0;
  const total = trackMessages.length;

  // Per-track reaction collectors
  for (const { message: msg, track } of trackMessages) {
    const collector = msg.createReactionCollector({
      filter: (reaction, user) => !user.bot && TRACK_REACTIONS.includes(reaction.emoji.name),
      time: REACTION_TIMEOUT_MS,
      max: 1
    });

    collector.on('collect', async (reaction) => {
      if (reaction.emoji.name === REACTION_APPROVE) {
        await approveTrack(track, config, channel);
        track.status = 'approved';
        approved++;
      } else if (reaction.emoji.name === REACTION_SKIP) {
        track.status = 'skipped';
        skipped++;
        await channel.send(`Skipped: ${track.name}`);
      } else if (reaction.emoji.name === REACTION_EDIT) {
        await channel.send(`**Edit ${track.name}** -- Reply with your changes and I'll regenerate.`);
      }
      updateSummary(summaryMsg, total, approved, skipped);
    });
  }

  // Summary batch controls
  const summaryCollector = summaryMsg.createReactionCollector({
    filter: (reaction, user) => !user.bot && SUMMARY_REACTIONS.includes(reaction.emoji.name),
    time: REACTION_TIMEOUT_MS,
    max: 1
  });

  summaryCollector.on('collect', async (reaction) => {
    if (reaction.emoji.name === REACTION_APPROVE) {
      for (const { track } of trackMessages) {
        if (track.status === 'pending') {
          await approveTrack(track, config, channel);
          track.status = 'approved';
          approved++;
        }
      }
      await channel.send(`**Approved all** -- ${approved} tracks published.`);
    } else if (reaction.emoji.name === REACTION_SKIP) {
      for (const { track } of trackMessages) {
        if (track.status === 'pending') {
          track.status = 'skipped';
          skipped++;
        }
      }
      await channel.send(`**Cancelled all** remaining tracks.`);
    }
    updateSummary(summaryMsg, total, approved, skipped);
  });
}

/**
 * Approve a single track: create promo, post to Facebook, notify channel.
 */
async function approveTrack(track, config, channel) {
  // Serialize publish operations to prevent concurrent monkey-patching
  // of screenshots.getScreenshotPath
  publishLock = publishLock.then(() => doApproveTrack(track, config, channel));
  return publishLock;
}

async function doApproveTrack(track, config, channel) {
  try {
    // 1. Create promo in Supabase
    const promo = await createRacenightPromo(track, config);
    console.log(`[racenight] Promo created: ${promo.code}`);

    // 2. Post to Facebook with racenight screenshot override
    const fbPost = {
      theme: 'race_night',
      content: {
        fb: {
          text: track.post_text,
          hashtags: [] // hashtags already embedded in post_text
        }
      }
    };

    // Temporarily override getScreenshotPath so publisher-fb uses
    // the track-specific racenight screenshot instead of the
    // theme-based screenshot lookup.
    const originalGetScreenshotPath = screenshots.getScreenshotPath;
    screenshots.getScreenshotPath = () => track.screenshot_path;

    let fbPostId;
    try {
      fbPostId = await postToFacebook(fbPost);
    } finally {
      screenshots.getScreenshotPath = originalGetScreenshotPath;
    }

    console.log(`[racenight] Published to FB: ${fbPostId}`);
    await channel.send(`**Published: ${track.name}**\nPromo: \`${track.promo_code}\`\nFB Post ID: ${fbPostId}`);
  } catch (err) {
    console.error(`[racenight] Publish failed for ${track.name}: ${err.message}`);
    await channel.send(`**Failed: ${track.name}** -- ${err.message}`);
  }
}

/**
 * Update the summary embed with current approval counts.
 */
function updateSummary(summaryMsg, total, approved, skipped) {
  summaryMsg.edit({
    embeds: [buildSummaryEmbed(total, approved, skipped)]
  }).catch(() => {});
}

module.exports = { handleRacenight };
