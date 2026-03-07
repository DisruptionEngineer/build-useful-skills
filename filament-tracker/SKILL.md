---
name: filament-tracker
description: Track 3D printer filament inventory via Discord commands in #filament with spool management, usage deduction, and low-stock alerts. Use when adding new filament spools, deducting material after a print, checking remaining stock levels, identifying spools below the low-stock threshold, or planning filament purchases before a large print.
metadata: {"clawdbot":{"emoji":"🧵","requires":{"anyBins":["jq"]},"os":["linux","darwin","win32"]}}
---

# Filament Tracker

Listen on `#filament` for inventory management commands. Track spools by material type, color, brand, and remaining weight. Deduct usage after prints and post alerts when stock runs low. Responds to filament usage reminders from print-queue-manager when a print completes.

## When to Use

- A `📎 PR-XXXX completed using FIL-XXX` reminder arrives from print-queue-manager
- User types `!stock` to see current filament inventory
- Adding a new spool with `!add PLA Black "Bambu Lab" 1000`
- Deducting usage after a print with `!use FIL-001 45`
- Checking low-stock spools with `!low`

## Prerequisites

### Data File

```bash
# Initialize filament inventory
if [ ! -f ~/.agents/data/filament-inventory.json ]; then
  echo '{"spools": []}' > ~/.agents/data/filament-inventory.json
fi
```

### Channel Setup

`#filament` channel under the "3D Printing" category. Bot needs `READ_MESSAGES` and `SEND_MESSAGES`.

## Utility Functions

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}
function saveJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

const INVENTORY_PATH = path.join(os.homedir(), '.agents/data/filament-inventory.json');
function loadInventory() { return loadJSON(INVENTORY_PATH) || { spools: [] }; }
function saveInventory(data) { saveJSON(INVENTORY_PATH, data); }
```

## Spool Schema

```json
{
  "spools": [
    {
      "id": "FIL-0001",
      "material": "PLA",
      "color": "Black",
      "brand": "Bambu Lab",
      "weight_remaining_g": 750,
      "weight_initial_g": 1000,
      "added_at": "2026-02-27T18:00:00.000Z",
      "notes": ""
    }
  ]
}
```

## Commands

### `!stock` — Show Inventory

```javascript
if (message.content.trim() === '!stock') {
  const inventory = loadInventory();
  if (!inventory.spools.length) {
    await message.channel.send('No filament in inventory. Add spools with `!add <material> <color> <brand> [weight]`');
    return;
  }

  let output = '**🧵 Filament Inventory**\n\n';
  for (const spool of inventory.spools) {
    const pct = Math.round((spool.weight_remaining_g / spool.weight_initial_g) * 100);
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    const warn = spool.weight_remaining_g < 200 ? ' ⚠️' : '';
    output += `\`${spool.id}\` — **${spool.material} ${spool.color}** (${spool.brand})\n`;
    output += `  [${bar}] ${spool.weight_remaining_g}g / ${spool.weight_initial_g}g (${pct}%)${warn}\n`;
  }
  output += `\n${inventory.spools.length} spool(s)`;
  await message.channel.send(output);
}
```

### `!add <material> <color> <brand> [weight_g]` — Add a Spool

Weight defaults to 1000g (standard 1kg spool).

```javascript
const addMatch = message.content.match(/^!add\s+(\S+)\s+(\S+)\s+"?([^"]+)"?\s*(\d+)?/i);
if (addMatch) {
  const [, material, color, brand, weightStr] = addMatch;
  const weight = parseInt(weightStr) || 1000;
  const inventory = loadInventory();

  const id = generateSpoolId(inventory);
  const spool = {
    id,
    material: material.toUpperCase(),
    color: color.charAt(0).toUpperCase() + color.slice(1).toLowerCase(),
    brand: brand.trim(),
    weight_remaining_g: weight,
    weight_initial_g: weight,
    added_at: new Date().toISOString(),
    notes: ''
  };

  inventory.spools.push(spool);
  saveInventory(inventory);

  await message.channel.send(
    `✅ **Added ${id}** — ${spool.material} ${spool.color} (${spool.brand}) • ${weight}g`
  );
}
```

```bash
# Add a spool via jq
jq --arg id "FIL-0001" --arg mat "PLA" --arg col "Black" --arg brand "Bambu Lab" \
   --argjson wt 1000 --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
   '.spools += [{
     id: $id, material: $mat, color: $col, brand: $brand,
     weight_remaining_g: $wt, weight_initial_g: $wt,
     added_at: $ts, notes: ""
   }]' ~/.agents/data/filament-inventory.json > /tmp/fil-tmp.json \
   && mv /tmp/fil-tmp.json ~/.agents/data/filament-inventory.json
```

### `!use <spool_id> <grams>` — Deduct Usage

```javascript
const useMatch = message.content.match(/^!use\s+(FIL-\d{4})\s+(\d+)/i);
if (useMatch) {
  const [, spoolId, gramsStr] = useMatch;
  const grams = parseInt(gramsStr);
  const inventory = loadInventory();
  const spool = inventory.spools.find(s => s.id === spoolId.toUpperCase());

  if (!spool) { await message.reply(`Spool \`${spoolId}\` not found.`); return; }

  spool.weight_remaining_g = Math.max(0, spool.weight_remaining_g - grams);
  saveInventory(inventory);

  let reply = `📉 Deducted ${grams}g from **${spool.id}** — ${spool.weight_remaining_g}g remaining`;
  if (spool.weight_remaining_g < 200) {
    reply += '\n⚠️ **Low stock warning!** Consider reordering.';
  }
  await message.channel.send(reply);
}
```

```bash
# Deduct usage via jq
jq --arg id "FIL-0001" --argjson g 45 \
   '(.spools[] | select(.id == $id)).weight_remaining_g |= [. - $g, 0] | max' \
   ~/.agents/data/filament-inventory.json > /tmp/fil-tmp.json \
   && mv /tmp/fil-tmp.json ~/.agents/data/filament-inventory.json
```

### `!low` — Show Low-Stock Spools

```javascript
if (message.content.trim() === '!low') {
  const inventory = loadInventory();
  const low = inventory.spools.filter(s => s.weight_remaining_g < 200);

  if (!low.length) {
    await message.channel.send('✅ All filament spools are well-stocked!');
    return;
  }

  let output = '**⚠️ Low Filament Alert**\n\n';
  for (const s of low) {
    output += `⚠️ \`${s.id}\` — ${s.material} ${s.color} • **${s.weight_remaining_g}g** remaining\n`;
  }
  await message.channel.send(output);
}
```

## ID Generation

```javascript
function generateSpoolId(inventory) {
  if (!inventory.spools.length) return 'FIL-0001';
  const lastId = inventory.spools[inventory.spools.length - 1].id;
  const num = parseInt(lastId.split('-')[1], 10) + 1;
  return `FIL-${String(num).padStart(4, '0')}`;
}
```

## Low-Stock Threshold

The default threshold is 200g. Spools below this level are:
- Flagged with ⚠️ in `!stock`
- Shown when running `!low`
- Included in the weekly digest's filament alert section

## Shell Queries

```bash
# Full inventory
jq '.spools[] | {id, material, color, remaining: .weight_remaining_g}' ~/.agents/data/filament-inventory.json

# Low stock only
jq '.spools[] | select(.weight_remaining_g < 200) | {id, material, color, remaining: .weight_remaining_g}' ~/.agents/data/filament-inventory.json

# Total weight remaining across all spools
jq '[.spools[].weight_remaining_g] | add' ~/.agents/data/filament-inventory.json
```

## Tips

- Spool IDs auto-increment: FIL-0001, FIL-0002, etc. You never pick the ID.
- Material names are auto-uppercased, colors auto-title-cased for consistency.
- Remaining weight clamps at zero — it can't go negative.
- Use descriptive brand names ("Bambu Lab" vs "Generic") for reorder tracking.
- The `!stock` command shows a visual progress bar for quick scanning.
- After a print completes, the queue manager posts a reminder in `#filament` to log usage.
- Weight estimates from slicer software (Cura, PrusaSlicer, BambuStudio) are usually accurate to within 5%.
- Standard spools are 1000g but some brands sell 750g or 500g — set weight accordingly on `!add`.
- The initial weight is stored separately from remaining, so you can always see the original spool size.
