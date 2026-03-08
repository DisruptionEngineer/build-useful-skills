const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Create a racenight promo code for a specific track.
 * The promo expires at 6 AM ET the next morning.
 */
async function createRacenightPromo(track, config) {
  const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
  const today = new Date();
  const mmdd = String(today.getMonth() + 1).padStart(2, '0')
    + String(today.getDate()).padStart(2, '0');
  const code = `TENTHS-${abbrev}-${mmdd}`;

  // Calculate expiry: 6 AM ET next morning
  // config.promo_expiry_hour_utc is 10 (6 AM ET during EDT) or 11 (during EST)
  const expiryHourUTC = config.promo_expiry_hour_utc || 10;
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(expiryHourUTC, 0, 0, 0);
  const validUntil = tomorrow.toISOString();

  // valid_from: now
  const validFrom = today.toISOString();

  const maxUses = config.promo_max_uses || 10;
  const description = `Race night promo - ${track.name} ${today.getMonth() + 1}/${today.getDate()}`;

  // Check if promo already exists for this track/date
  const { data: existing } = await supabase
    .from('promotions')
    .select('code')
    .eq('code', code)
    .maybeSingle();

  if (existing) {
    console.log(`[promo] Already exists: ${code}`);
    return { code, url: `https://tenths.racing/promo/${code}`, existing: true };
  }

  const { error } = await supabase.from('promotions').insert({
    code,
    trial_days: 1,
    max_uses: maxUses,
    valid_from: validFrom,
    valid_until: validUntil,
    description,
    is_active: true,
    racenight: true,
    use_count: 0
  });

  if (error) {
    console.error(`[promo] Creation failed for ${code}: ${error.message}`);
    throw new Error(`Failed to create promo: ${error.message}`);
  }

  console.log(`[promo] Created: ${code} (${maxUses} uses, expires ${validUntil})`);
  return {
    code,
    url: `https://tenths.racing/promo/${code}`,
    max_uses: maxUses,
    expires: validUntil,
    existing: false
  };
}

module.exports = { createRacenightPromo };
