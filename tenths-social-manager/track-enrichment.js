const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Enrich a list of discovered tracks with:
 * 1. Supabase cached data (if known)
 * 2. Nominatim geocoding (if new — gets lat/lng/state)
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
      console.log(`[enrich] Cache hit: ${track.name} (${cached.state})`);
      trackData = {
        ...track,
        is_known: true,
        state: cached.state || track.state,
        location: cached.location || track.location,
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
      console.log(`[enrich] Cache miss, geocoding: ${track.name}`);
      const researched = await researchTrack(track.name, track.state);
      trackData = {
        ...track,
        is_known: false,
        ...researched
      };
      // Save to Supabase for future runs (only if we got useful data)
      if (trackData.lat && trackData.lng) {
        await saveTrack(trackData);
      } else {
        console.log(`[enrich] Skipping save for ${track.name} (no coordinates)`);
      }
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

/**
 * Use Nominatim (OpenStreetMap) geocoding to find a track's location.
 * Free, no API key needed. Returns lat/lng/state for region filtering.
 */
async function researchTrack(name, state) {
  try {
    // Search with "speedway" or "raceway" context for better results
    const query = encodeURIComponent(`${name}, USA`);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'TenthsRacing/1.0 (racenight-bot)' }
    });
    const results = await res.json();

    if (results.length > 0) {
      const r = results[0];
      const address = r.address || {};

      // Extract state from ISO3166-2 code (format: "US-IN" → "IN")
      const iso = address['ISO3166-2-lvl4'] || '';
      const stateCode = iso.startsWith('US-') ? iso.substring(3) : null;

      console.log(`[enrich] Geocoded ${name} → ${stateCode || '?'} (${r.lat}, ${r.lon})`);

      return {
        state: stateCode || state,
        location: [address.city || address.town || address.village, stateCode].filter(Boolean).join(', '),
        surface: null,    // unknown from geocoding
        length: null,     // unknown from geocoding
        banking: null,    // unknown from geocoding
        shape: 'oval',
        elevation: null,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        facebook_page_url: null,
        abbreviation: makeAbbreviation(name)
      };
    }

    console.log(`[enrich] Geocoding returned no results for ${name}`);
  } catch (err) {
    console.error(`[enrich] Geocoding failed for ${name}: ${err.message}`);
  }

  // Fallback: no location data
  return {
    state: state || null,
    location: '',
    surface: null,
    length: null,
    banking: null,
    shape: 'oval',
    lat: null,
    lng: null,
    facebook_page_url: null,
    abbreviation: makeAbbreviation(name)
  };
}

/** Generate a 3-4 letter abbreviation from a track name. */
function makeAbbreviation(name) {
  // Take first letter of each word, cap at 4
  const words = name.replace(/speedway|raceway|motorsports|park|complex/gi, '').trim().split(/\s+/);
  if (words.length >= 2) {
    return words.map(w => w[0]).join('').toUpperCase().substring(0, 4);
  }
  return name.substring(0, 3).toUpperCase();
}

async function saveTrack(trackData) {
  const id = trackData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const row = {
    id,
    name: trackData.name,
    state: trackData.state || null,
    location: trackData.location || null,
    shape: trackData.shape || 'oval',
    facebook_page_url: trackData.facebook_page_url || null,
    abbreviation: trackData.abbreviation || null,
    lat: typeof trackData.lat === 'number' ? trackData.lat : null,
    lng: typeof trackData.lng === 'number' ? trackData.lng : null,
  };

  // Only include typed fields if they have valid values (avoid sending "unknown" to numeric columns)
  if (trackData.surface && ['asphalt', 'concrete', 'dirt', 'mixed'].includes(trackData.surface)) {
    row.surface = trackData.surface;
  }
  if (typeof trackData.length === 'number') {
    row.length = trackData.length;
  }
  if (typeof trackData.banking === 'number') {
    row.banking = trackData.banking;
  }

  const { error } = await supabase.from('tracks').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error(`[enrich] Save failed for ${trackData.name}: ${error.message}`);
  } else {
    console.log(`[enrich] Saved ${trackData.name} to DB`);
  }
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
