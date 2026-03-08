const { execAsync } = require('./utils');

/**
 * Generate a personalized Facebook post for a race night track.
 * Uses AI with track context, weather, and physics knowledge.
 */
async function generateRacenightPost(track, tip, promoCode) {
  const weatherStr = track.weather
    ? `${track.weather.temp_f}°F, ${track.weather.humidity}% humidity, wind ${track.weather.wind_speed_mph} mph, ${track.weather.precip_chance}% chance of rain`
    : 'Weather data not available';

  const fbTag = track.facebook_page_url
    ? `@${extractFBPageName(track.facebook_page_url)}`
    : '';

  const prompt = `Write a Facebook post promoting free race-night access to the Tenths racing app.

TRACK: ${track.name} (${track.state || ''})
SURFACE: ${track.surface || 'unknown'}
LENGTH: ${track.length || 'unknown'}
BANKING: ${track.banking || 'unknown'}
SHAPE: ${track.shape || 'oval'}
DIVISIONS TONIGHT: ${(track.divisions_tonight || []).join(', ')}
WEATHER: ${weatherStr}
PROMO CODE: ${promoCode}
PROMO URL: https://tenths.racing/promo/${promoCode}
RACE TIP: ${tip}
FB TAG: ${fbTag}

FORMAT — write EXACTLY this structure:
1. Opening line with racing emoji and track name (mention TONIGHT)
2. 1-2 sentences about tonight's specific conditions at this track (surface, weather, what makes tonight interesting)
3. The race tip prefixed with 💡
4. The promo CTA: "🎁 First 10 racers get FREE full access to Tenths tonight — your crew chief in your pocket. No credit card needed."
5. The promo link: "👉 tenths.racing/promo/${promoCode}"
6. The FB tag line (if provided): "${fbTag}"
7. Hashtags line: 3-5 relevant hashtags

VOICE: Technical but approachable. Talk like a fellow racer, not marketing. Short sentences.
MAX LENGTH: 600 characters total (excluding hashtags line).

Return ONLY the post text, nothing else.`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --thinking low --timeout 60`,
      { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    let post = (envelope.result || envelope.content || envelope.text || '').trim();
    // Strip markdown code fences if AI wraps output
    post = post.replace(/```[\s\S]*?```/g, '').trim();
    return post;
  } catch (err) {
    console.error(`[post-gen] Failed for ${track.name}: ${err.message}`);
    return buildFallbackPost(track, tip, promoCode, fbTag);
  }
}

function buildFallbackPost(track, tip, promoCode, fbTag) {
  const lines = [
    `🏁 Racing TONIGHT at ${track.name}!`,
    '',
    track.weather
      ? `It's ${track.weather.temp_f}°F with ${track.weather.humidity}% humidity — ${track.surface || 'the track'} is going to be interesting tonight.`
      : `Tonight's races are on at ${track.name}.`,
    '',
    `💡 ${tip}`,
    '',
    `🎁 First 10 racers get FREE full access to Tenths tonight — your crew chief in your pocket. No credit card needed.`,
    '',
    `👉 tenths.racing/promo/${promoCode}`,
  ];
  if (fbTag) lines.push('', fbTag);
  lines.push('', '#ShortTrackRacing #RaceNight #TenthsRacing');
  return lines.join('\n');
}

function extractFBPageName(url) {
  if (!url) return '';
  const match = url.match(/facebook\.com\/([^/?]+)/);
  return match ? match[1] : '';
}

module.exports = { generateRacenightPost };
