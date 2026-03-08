const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE, '.agents', 'data', 'tenths-racenight-config.json'
);

const DEFAULT_CONFIG = {
  regions: ['OH', 'PA', 'MI', 'IN', 'WV', 'KY'],
  divisions: ['figure-8', 'street-stock', 'compact', 'factory-stock', 'hornet'],
  max_tracks_per_run: 20,
  promo_max_uses: 10,
  promo_expiry_hour_utc: 10, // 6 AM ET = 10 UTC (during EDT)
  screenshot_cleanup_days: 7,
  crew_chief_url: 'https://tenths.racing',
  // Fuzzy match aliases: MyRacePass class name → our division ID
  division_aliases: {
    'figure 8': 'figure-8',
    'fig 8': 'figure-8',
    'f8': 'figure-8',
    'figure-8': 'figure-8',
    'figure eight': 'figure-8',
    'street stock': 'street-stock',
    'streetstock': 'street-stock',
    'compact': 'compact',
    'compacts': 'compact',
    'mini stock': 'compact',
    'factory stock': 'factory-stock',
    'pure stock': 'factory-stock',
    'hornet': 'hornet',
    'hornets': 'hornet',
    'front wheel drive': 'hornet',
    'fwd': 'hornet'
  }
};

function loadRacenightConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveRacenightConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function matchDivision(className, config) {
  const normalized = className.toLowerCase().trim();
  const aliases = config.division_aliases || DEFAULT_CONFIG.division_aliases;
  // Direct alias match
  if (aliases[normalized]) return aliases[normalized];
  // Substring match against configured divisions
  for (const div of config.divisions) {
    if (normalized.includes(div.replace('-', ' ')) || normalized.includes(div)) {
      return div;
    }
  }
  // Substring match against aliases
  for (const [alias, div] of Object.entries(aliases)) {
    if (normalized.includes(alias)) return div;
  }
  return null;
}

module.exports = { loadRacenightConfig, saveRacenightConfig, matchDivision, DEFAULT_CONFIG };
