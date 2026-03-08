const { createClient } = require('@supabase/supabase-js');
const { execAsync } = require('./utils');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Enrich a list of discovered tracks with:
 * 1. Supabase cached data (if known)
 * 2. AI-researched data (if new)
 * 3. Tonight's weather from Open-Meteo
 */
async function enrichTracks(tracks) {
  const enriched = [];

  for (const track of tracks) {
    console.log(`[enrich] Processing: ${track.name}`);

    // 1. Check Supabase cache
    const cached = await lookupTrack(track.name, track.state);

    let trackData;
    if (cached) {
      console.log(`[enrich] Cache hit: ${track.name}`);
      trackData = {
        ...track,
        is_known: true,
        surface: cached.surface,
        length: cached.length,
        banking: cached.banking,
        shape: cached.shape,
        facebook_page_url: cached.facebook_page_url,
        abbreviation: cached.abbreviation,
        lat: cached.lat,
        lng: cached.lng,
        supabase_id: cached.id
      };
    } else {
      console.log(`[enrich] Cache miss, researching: ${track.name}`);
      const researched = await researchTrack(track.name, track.state);
      trackData = {
        ...track,
        is_known: false,
        ...researched
      };
      // Save to Supabase for future runs
      await saveTrack(trackData);
    }

    // 2. Fetch weather
    if (trackData.lat && trackData.lng) {
      trackData.weather = await fetchWeather(trackData.lat, trackData.lng);
    } else {
      trackData.weather = null;
    }

    enriched.push(trackData);
  }

  return enriched;
}

async function lookupTrack(name, state) {
  let { data } = await supabase
    .from('tracks')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .maybeSingle();

  return data;
}

async function researchTrack(name, state) {
  const prompt = `Research the short track racing venue "${name}" in ${state || 'USA'}.
Return ONLY a JSON object with these fields:
{
  "surface": "dirt" | "asphalt" | "concrete" | "mixed",
  "length": "1/4 mile" (track length as string),
  "banking": "12 degrees" (banking angle as string, or "flat" if unknown),
  "shape": "oval" | "figure-8" | "road-course" | "d-shaped",
  "elevation": number (feet above sea level, estimate if needed),
  "lat": number (latitude),
  "lng": number (longitude),
  "facebook_page_url": "https://facebook.com/..." (official FB page URL, or null),
  "abbreviation": "XXX" (3-4 letter abbreviation, e.g. PVL for Painesville)
}`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --json --thinking medium --timeout 60`,
      { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    const text = envelope.result || envelope.content || envelope.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.error(`[enrich] Research failed for ${name}: ${err.message}`);
  }

  // Fallback: minimal data
  return {
    surface: 'unknown',
    length: 'unknown',
    banking: 'unknown',
    shape: 'oval',
    lat: null,
    lng: null,
    facebook_page_url: null,
    abbreviation: name.substring(0, 3).toUpperCase()
  };
}

async function saveTrack(trackData) {
  const id = trackData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { error } = await supabase.from('tracks').upsert({
    id,
    name: trackData.name,
    location: trackData.location || `${trackData.state}, USA`,
    surface: trackData.surface,
    length: trackData.length,
    banking: trackData.banking,
    shape: trackData.shape,
    facebook_page_url: trackData.facebook_page_url,
    abbreviation: trackData.abbreviation,
    lat: trackData.lat,
    lng: trackData.lng
  }, { onConflict: 'id' });

  if (error) console.error(`[enrich] Save failed for ${trackData.name}: ${error.message}`);
}

async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lng}`
    + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation_probability`
    + `&temperature_unit=fahrenheit`
    + `&wind_speed_unit=mph`
    + `&timezone=America/New_York`
    + `&forecast_days=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    // Find the 6 PM hour (typical race start)
    const hours = data.hourly?.time || [];
    const raceHourIndex = hours.findIndex(t => t.includes('T18:'));
    const i = raceHourIndex >= 0 ? raceHourIndex : Math.min(18, hours.length - 1);

    return {
      temp_f: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      wind_speed_mph: data.hourly.wind_speed_10m[i],
      wind_direction: data.hourly.wind_direction_10m[i],
      precip_chance: data.hourly.precipitation_probability[i]
    };
  } catch (err) {
    console.error(`[weather] Failed for ${lat},${lng}: ${err.message}`);
    return null;
  }
}

module.exports = { enrichTracks, lookupTrack, fetchWeather };
