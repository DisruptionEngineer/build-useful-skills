---
name: general-chat
description: Answer quick questions in Discord's #general channel with fast, focused responses. Use when a user asks about current weather, local events, quick calculations, definitions, time zones, unit conversions, or any short-answer query that doesn't need a full pipeline. Reacts with ⚡ to signal quick-response mode and replies concisely in-channel.
metadata: {"clawdbot":{"emoji":"⚡","requires":{"anyBins":["node","curl"]},"os":["linux","darwin","win32"]}}
---

# General Chat

Listen on `#general` for messages from authorized users. Classify each message into a query type (weather, events, calculation, definition, general Q&A), react with ⚡ immediately to signal the bot is working, then reply with a concise, direct answer. This is the server's fast-lane: no pipelines, no refinement loops, no data files — just quick responses.

## When to Use

- A user asks about current or forecasted weather for any location
- A user wants to know about local or upcoming events near a city or date
- Quick math, unit conversions, time zone differences, or calculations
- Word definitions, acronym lookups, or one-sentence factual questions
- "What time is it in Tokyo?" / "How many days until Christmas?" style queries
- Any message in `#general` that reads as a direct question expecting a fast answer
- Checking if the bot is online and responsive

## Prerequisites

### Shared Bot

Same OpenClaw Discord bot as the rest of the server. No separate bot needed.

```bash
echo $DISCORD_BOT_TOKEN
```

### Weather API

Uses [Open-Meteo](https://open-meteo.com/) (free, no key required) with a geocoding call to resolve city names to coordinates.

```bash
# Test geocoding
curl -s "https://geocoding-api.open-meteo.com/v1/search?name=Austin&count=1&language=en&format=json" | jq '.results[0] | {name, latitude, longitude, country}'

# Test weather fetch
curl -s "https://api.open-meteo.com/v1/forecast?latitude=30.27&longitude=-97.74&current=temperature_2m,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph" | jq '.current'
```

### Web Search for Events / Current Info

Uses a lightweight search via the `SERPER_API_KEY` env variable (or falls back to DuckDuckGo instant answer API).

```bash
# Test DuckDuckGo instant answer (no key needed)
curl -s "https://api.duckduckgo.com/?q=Austin+TX+events+this+weekend&format=json&no_redirect=1" | jq '{AbstractText, RelatedTopics: (.RelatedTopics[:3] | map(.Text))}'

# Test Serper (if key configured)
curl -s -X POST "https://google.serper.dev/search" \
  -H "X-API-KEY: $SERPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q":"Austin TX events this weekend","num":3}' | jq '.organic[:3] | map({title, snippet})'
```

### Channel Permission

The bot needs `READ_MESSAGES`, `SEND_MESSAGES`, and `ADD_REACTIONS` in `#general`.

```bash
openclaw channels resolve general
```

## Query Classification

The bot classifies each incoming message into one of five types using keyword matching before calling any external service.

```javascript
const QUERY_TYPES = {
  weather: {
    keywords: ['weather', 'temperature', 'forecast', 'rain', 'sunny', 'snow',
               'humidity', 'wind', 'hot', 'cold', 'degrees', 'raining', 'storm'],
    extract: /(?:weather|temp(?:erature)?|forecast)\s+(?:in|for|at|near)?\s*([a-z\s,]+)/i
  },
  events: {
    keywords: ['events', 'happening', 'things to do', 'what\'s on', 'shows',
               'concerts', 'weekend', 'tonight', 'this week', 'nearby'],
    extract: /(?:events?|happening|things? to do)\s+(?:in|near|around|at)?\s*([a-z\s,]+)?/i
  },
  calculation: {
    keywords: ['how much', 'how many', 'calculate', 'convert', 'what is',
               'equals', 'plus', 'minus', 'times', 'divided', '%', 'percent',
               'how far', 'how long', 'how tall', 'mph', 'km', 'miles', 'kg', 'lbs'],
    extract: null
  },
  time: {
    keywords: ['time in', 'what time', 'timezone', 'time zone', 'utc', 'gmt',
               'days until', 'how long until', 'when is'],
    extract: null
  },
  general: {
    keywords: [],  // fallback
    extract: null
  }
};

function classifyQuery(text) {
  const lower = text.toLowerCase();
  for (const [type, config] of Object.entries(QUERY_TYPES)) {
    if (type === 'general') continue;
    if (config.keywords.some(k => lower.includes(k))) {
      return { type, extract: config.extract ? config.extract.exec(text)?.[1]?.trim() : null };
    }
  }
  return { type: 'general', extract: null };
}
```

## Step-by-Step Message Handling

### Step 1: Listen and Filter

```javascript
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'general') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  // Ignore very short messages that aren't questions
  if (message.content.trim().length < 5) return;
  if (!looksLikeQuestion(message.content)) return;

  await handleGeneralQuery(message);
});

function looksLikeQuestion(text) {
  const t = text.trim();
  return t.endsWith('?') ||
         /^(what|who|where|when|why|how|is|are|can|does|do|will|would|could|should)\b/i.test(t) ||
         /\b(weather|events?|time|calculate|convert|temperature|forecast)\b/i.test(t);
}
```

### Step 2: React Immediately

React with ⚡ before doing any async work to give instant visual feedback.

```javascript
async function handleGeneralQuery(message) {
  try {
    await message.react('⚡');

    const { type, extract } = classifyQuery(message.content);
    let answer;

    switch (type) {
      case 'weather':
        answer = await getWeatherAnswer(message.content, extract);
        break;
      case 'events':
        answer = await getEventsAnswer(message.content, extract);
        break;
      case 'calculation':
        answer = await getCalculationAnswer(message.content);
        break;
      case 'time':
        answer = await getTimeAnswer(message.content);
        break;
      default:
        answer = await getGeneralAnswer(message.content);
    }

    await message.reply(answer);
  } catch (err) {
    console.error('[general-chat] Error:', err);
    await message.reply(`Sorry, couldn't fetch that. Try again or be more specific.`);
  }
}
```

### Step 3: Weather Responses

Resolve city name to coordinates, then fetch current conditions.

```javascript
async function getWeatherAnswer(text, cityHint) {
  const city = cityHint || extractCityFromText(text) || 'Austin, TX';

  // Geocode
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const geoResp = await fetch(geoUrl);
  const geoData = await geoResp.json();

  if (!geoData.results?.length) {
    return `Couldn't find location: **${city}**. Try including state or country.`;
  }

  const { name, latitude, longitude, country_code } = geoData.results[0];

  // Fetch weather
  const wxUrl = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch` +
    `&forecast_days=3&timezone=auto`;

  const wxResp = await fetch(wxUrl);
  const wx = await wxResp.json();
  const c = wx.current;

  const condition = WMO_CODES[c.weathercode] || 'Unknown';
  const feelsLike = Math.round(c.apparent_temperature);
  const temp = Math.round(c.temperature_2m);
  const wind = Math.round(c.windspeed_10m);
  const precip = c.precipitation.toFixed(2);

  // 3-day forecast summary
  const days = ['Today', 'Tomorrow', 'Day 3'];
  const forecast = days.map((label, i) => {
    const hi = Math.round(wx.daily.temperature_2m_max[i]);
    const lo = Math.round(wx.daily.temperature_2m_min[i]);
    const cond = WMO_CODES[wx.daily.weathercode[i]] || '?';
    return `${label}: ${cond} ${hi}°/${lo}°F`;
  }).join(' | ');

  return [
    `**${name} (${country_code.toUpperCase()})** — ${condition}`,
    `🌡️ ${temp}°F (feels ${feelsLike}°F) | 💨 ${wind} mph | 🌧️ ${precip}" precip`,
    `📅 ${forecast}`
  ].join('\n');
}

// WMO Weather Interpretation Codes (subset)
const WMO_CODES = {
  0: 'Clear sky ☀️', 1: 'Mainly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️',
  45: 'Foggy 🌫️', 48: 'Icy fog 🌫️', 51: 'Light drizzle 🌦️', 53: 'Drizzle 🌦️',
  55: 'Heavy drizzle 🌧️', 61: 'Light rain 🌧️', 63: 'Rain 🌧️', 65: 'Heavy rain 🌧️',
  71: 'Light snow 🌨️', 73: 'Snow 🌨️', 75: 'Heavy snow ❄️', 80: 'Rain showers 🌦️',
  81: 'Showers 🌧️', 82: 'Violent showers ⛈️', 95: 'Thunderstorm ⛈️', 99: 'Hail storm ⛈️'
};
```

### Step 4: Events Responses

```javascript
async function getEventsAnswer(text, cityHint) {
  const city = cityHint || extractCityFromText(text) || 'local area';
  const query = `${city} events this weekend`;

  // Try Serper if key is available
  if (process.env.SERPER_API_KEY) {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5, gl: 'us' })
    });
    const data = await resp.json();
    const results = (data.organic || []).slice(0, 3);
    if (results.length) {
      const lines = results.map(r => `• **${r.title}** — ${r.snippet?.slice(0, 100)}...`);
      return `**Events near ${city}:**\n${lines.join('\n')}\n\n*Search: "${query}"*`;
    }
  }

  // Fallback: DuckDuckGo instant answer
  const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
  const ddgResp = await fetch(ddgUrl);
  const ddg = await ddgResp.json();

  const abstract = ddg.AbstractText;
  const related = (ddg.RelatedTopics || []).slice(0, 3).map(t => `• ${t.Text || t.Name}`);

  if (abstract || related.length) {
    return [
      abstract ? `**${abstract}**` : `Searching events near **${city}**:`,
      ...related
    ].join('\n');
  }

  return `No event data found for **${city}**. Try Eventbrite or Meetup for local listings.`;
}
```

### Step 5: Calculation and Time Responses

```javascript
async function getCalculationAnswer(text) {
  // Simple expression eval (no user input eval — regex-extracted only)
  const mathMatch = text.match(/[\d\s\+\-\*\/\.\(\)%]+/);
  if (mathMatch) {
    const expr = mathMatch[0].trim();
    try {
      // Safe-evaluate: only allow numbers and math operators
      if (/^[\d\s\+\-\*\/\.\(\)%]+$/.test(expr)) {
        const result = Function(`"use strict"; return (${expr})`)();
        return `**${expr}** = **${result}**`;
      }
    } catch {}
  }

  // Unit conversion patterns
  const conversions = [
    { from: /(\d+\.?\d*)\s*(?:miles?|mi)\s+(?:to|in)\s+km/i, fn: v => `${v} mi = **${(v * 1.60934).toFixed(2)} km**` },
    { from: /(\d+\.?\d*)\s*km\s+(?:to|in)\s+miles?/i, fn: v => `${v} km = **${(v / 1.60934).toFixed(2)} mi**` },
    { from: /(\d+\.?\d*)\s*(?:lbs?|pounds?)\s+(?:to|in)\s+kg/i, fn: v => `${v} lbs = **${(v * 0.453592).toFixed(2)} kg**` },
    { from: /(\d+\.?\d*)\s*kg\s+(?:to|in)\s+(?:lbs?|pounds?)/i, fn: v => `${v} kg = **${(v / 0.453592).toFixed(2)} lbs**` },
    { from: /(\d+\.?\d*)\s*(?:°?f|fahrenheit)\s+(?:to|in)\s+(?:°?c|celsius)/i, fn: v => `${v}°F = **${(((v - 32) * 5) / 9).toFixed(1)}°C**` },
    { from: /(\d+\.?\d*)\s*(?:°?c|celsius)\s+(?:to|in)\s+(?:°?f|fahrenheit)/i, fn: v => `${v}°C = **${((v * 9) / 5 + 32).toFixed(1)}°F**` },
    { from: /(\d+\.?\d*)\s*(?:oz|ounces?)\s+(?:to|in)\s+(?:grams?|g)/i, fn: v => `${v} oz = **${(v * 28.3495).toFixed(2)} g**` },
    { from: /(\d+\.?\d*)\s*(?:gal|gallons?)\s+(?:to|in)\s+liters?/i, fn: v => `${v} gal = **${(v * 3.78541).toFixed(2)} L**` }
  ];

  for (const { from, fn } of conversions) {
    const m = text.match(from);
    if (m) return fn(parseFloat(m[1]));
  }

  return await getGeneralAnswer(text);
}

async function getTimeAnswer(text) {
  const timeZoneMap = {
    'new york': 'America/New_York', 'nyc': 'America/New_York',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
    'chicago': 'America/Chicago', 'denver': 'America/Denver',
    'london': 'Europe/London', 'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin',
    'tokyo': 'Asia/Tokyo', 'sydney': 'Australia/Sydney', 'dubai': 'Asia/Dubai',
    'utc': 'UTC', 'gmt': 'UTC'
  };

  const lower = text.toLowerCase();
  for (const [city, tz] of Object.entries(timeZoneMap)) {
    if (lower.includes(city)) {
      const localTime = new Date().toLocaleString('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      });
      return `🕐 **${city.charAt(0).toUpperCase() + city.slice(1)}:** ${localTime}`;
    }
  }

  // Days until date
  const untilMatch = text.match(/days? until (.+)/i);
  if (untilMatch) {
    const target = new Date(untilMatch[1]);
    if (!isNaN(target)) {
      const days = Math.ceil((target - new Date()) / 86400000);
      return `📅 **${days} day${days !== 1 ? 's' : ''}** until ${target.toDateString()}`;
    }
  }

  return await getGeneralAnswer(text);
}
```

### Step 6: General Q&A Fallback

```javascript
async function getGeneralAnswer(text) {
  // DuckDuckGo instant answer API
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(text)}&format=json&no_redirect=1&skip_disambig=1`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.AbstractText && data.AbstractText.length > 20) {
    const trimmed = data.AbstractText.slice(0, 300);
    const source = data.AbstractURL ? `\n*Source: ${data.AbstractURL}*` : '';
    return `${trimmed}${data.AbstractText.length > 300 ? '...' : ''}${source}`;
  }

  if (data.Answer) {
    return `**${data.Answer}**`;
  }

  if (data.Definition) {
    return `📖 **${data.Heading}:** ${data.Definition}`;
  }

  const related = (data.RelatedTopics || []).slice(0, 2).map(t => t.Text || '').filter(Boolean);
  if (related.length) {
    return related.join('\n');
  }

  return `I couldn't find a quick answer for that. Try searching directly or ask with more detail.`;
}
```

## Helper Utilities

```javascript
function extractCityFromText(text) {
  // Common patterns: "weather in Austin", "events near Dallas TX", "time in London"
  const patterns = [
    /(?:in|near|for|at|around)\s+([A-Z][a-zA-Z\s]+?)(?:\s*[\?,\.]|$)/,
    /([A-Z][a-zA-Z\s]+?),?\s+(?:TX|CA|NY|FL|WA|CO|IL|AZ|GA|NC|VA|OH|PA|MA|NJ|MI|MN|TN|WI|MO|MD|WV)\b/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function isAuthorizedUser(discordId) {
  const fs = require('fs');
  try {
    const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return config.authorized_users.some(u => u.discord_id === discordId);
  } catch { return false; }
}
```

## Registering the Bot

```javascript
client.once('ready', () => {
  console.log(`[general-chat] Online as ${client.user.tag}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

## Deploy via OpenClaw

```bash
# Register the skill
openclaw skills list

# Verify #general channel is resolvable
openclaw channels resolve general

# Check bot permissions in the channel
openclaw channels status general
```

## Tips

- React with ⚡ **before** any async call. Discord has a ~3 second expectation before users think the bot is broken. The reaction sets that expectation.
- Keep replies to 3–6 lines max. `#general` is a chat channel, not a wiki. If an answer needs more than 6 lines, summarize and link out.
- The `looksLikeQuestion` filter prevents the bot from responding to casual statements like "good morning" that happen to contain a weather keyword.
- Open-Meteo is free with no API key and has excellent uptime. It's the right default for weather. Only add OpenWeatherMap if you need hourly alerts or push notifications.
- The DuckDuckGo instant answer API returns an empty abstract for most queries — that's expected. It's strong for definitions, well-known facts, and unit conversions, weak for event listings.
- Serper ($50/mo for 50k queries) is worth enabling for events — DDG's event coverage is sparse. Configure `SERPER_API_KEY` in the bot's `.env` for better results.
- The calculation handler uses `Function()` with a strict regex guard, not `eval()` directly on user input. Do not relax the regex — only allow `[\d\s\+\-\*\/\.\(\)%]`.
- Time zone coverage is intentionally manual (not a library) to keep the skill dependency-free. Add new cities to `timeZoneMap` as needed.
- If the bot needs to handle `#general` alongside other pipelines, the `message.channel.name !== 'general'` guard ensures it won't interfere with other skill listeners.
- All responses are sent as `message.reply()` rather than `channel.send()` to keep context threaded per message.
