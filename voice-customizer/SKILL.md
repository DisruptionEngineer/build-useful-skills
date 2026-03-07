---
name: voice-customizer
description: Manage wake words and TTS voice profiles for the kitchen voice assistant via Discord. Use when training a new openWakeWord ONNX model, cloning a voice from a YouTube reference, switching the active wake word or voice, listing available options, or deploying configuration changes to the Pi voice assistant at 10.10.7.15.
metadata: {"clawdbot":{"emoji":"🎛️","requires":{"anyBins":["node","ssh"]},"os":["linux","darwin"]}}
---

# Voice Customizer

Manage custom wake words and cloned TTS voices for the Jarvis kitchen voice assistant on Pi 4. Users suggest a wake word or character voice in `#voice-customizer`, the skill checks availability, trains or clones as needed, and deploys to the Pi after approval. Wake words are trained via openWakeWord Docker on WatchTower; voices are cloned via openedai-speech XTTS v2 from YouTube reference audio. The Pi 4 runs the Jarvis voice pipeline (`jarvis.py`) with a Waveshare 2.13" e-Paper V4 display showing voice status.

## When to Use

- Training a custom openWakeWord model from a phrase (e.g. "hey kitchen")
- Cloning a character voice from a YouTube clip for TTS playback
- Listing available wake words or voices with their active status
- Switching the active wake word or voice on the Pi
- Deploying wake word ONNX models or voice WAV files to the voice assistant
- Checking whether a specific wake word or voice is already available
- Recovering custom voices after an openedai-speech container rebuild
- Diagnosing wake word training or yt-dlp failures on WatchTower

## Prerequisites

### Infrastructure Endpoints

```bash
# WatchTower (10.10.7.55) — training, TTS, audio processing
ssh root@10.10.7.55 "which yt-dlp ffmpeg docker && docker ps --filter name=openedai-speech --format '{{.Status}}'"
# Expected: paths + "Up X days"

# Pi 4 (10.10.7.15) — Jarvis voice assistant + e-Paper display
ssh pi@10.10.7.15 "ls ~/voice-assistant/config.json && systemctl is-active voice-assistant.service && systemctl is-active jarvis-display.service"
# Expected: config path + "active" + "active"

# TTS endpoint
curl -s http://10.10.7.55:8022/v1/models | python3 -m json.tool
```

### SSH Key Setup

```bash
# Passwordless SSH required from bot host to both targets
ssh-copy-id root@10.10.7.55 && ssh-copy-id pi@10.10.7.15
```

### Data File Initialization

```bash
mkdir -p ~/.agents/data

# Catalog — tracks all wake words and voices
if [ ! -f ~/.agents/data/voice-customizer-config.json ]; then
  cat > ~/.agents/data/voice-customizer-config.json << 'EOF'
{
  "wake_words": [
    {
      "slug": "hey-jarvis",
      "display": "hey jarvis",
      "model_name": "hey_jarvis",
      "status": "active",
      "threshold": 0.5,
      "added_at": "2026-01-01T00:00:00Z"
    }
  ],
  "voices": [
    { "slug": "alloy", "display": "alloy", "status": "active", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" },
    { "slug": "echo", "display": "echo", "status": "available", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" },
    { "slug": "fable", "display": "fable", "status": "available", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" },
    { "slug": "onyx", "display": "onyx", "status": "available", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" },
    { "slug": "nova", "display": "nova", "status": "available", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" },
    { "slug": "shimmer", "display": "shimmer", "status": "available", "is_builtin": true, "added_at": "2026-01-01T00:00:00Z" }
  ],
  "watchtower": { "host": "root@10.10.7.55", "voices_dir": "/mnt/user/appdata/openedai-speech/voices", "tts_url": "http://10.10.7.55:8022" },
  "pi": { "host": "pi@10.10.7.15", "config_path": "/home/pi/voice-assistant/config.json", "models_dir": "/home/pi/voice-assistant/models", "service": "voice-assistant.service" }
}
EOF
fi

# Pending approval state
if [ ! -f ~/.agents/data/voice-customizer-state.json ]; then
  echo '{"pending":[],"counter":0}' > ~/.agents/data/voice-customizer-state.json
fi
```

### WatchTower Directories

```bash
# Create voices directory for custom clones
ssh root@10.10.7.55 "mkdir -p /mnt/user/appdata/openedai-speech/voices"

# Create wake word training output directory
ssh root@10.10.7.55 "mkdir -p /mnt/user/appdata/openwakeword/models"
```

## Discord Command Reference

| Command | Action |
|---------|--------|
| `new wake word: hey kitchen` | Train a new openWakeWord model |
| `new voice: Darth Vader https://youtu.be/...` | Clone a voice from YouTube audio |
| `new voice: Elsa` | Clone voice (searches YouTube automatically) |
| `list voices` | Show all voices with active status |
| `list wake words` | Show all wake words with active status |
| `set voice darth-vader` | Switch active TTS voice |
| `set wake word hey-kitchen` | Switch active wake word |

## Command Parser

```javascript
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const DATA_DIR = path.join(process.env.HOME, '.agents', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'voice-customizer-config.json');
const STATE_PATH = path.join(DATA_DIR, 'voice-customizer-state.json');
const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');
const BOT_PATH = path.join(process.env.HOME, '.agents', 'config', 'discord-bot.json');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveJSON(p, data) {
  const tmp = `/tmp/vc-${Date.now()}.json`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}
function slugify(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function isValidSlug(s) { return /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(s); }
function isValidUrl(u) { return /^https?:\/\/[a-zA-Z0-9._\-\/\?=&%#+@!:]+$/.test(u); }
function isAuthorizedUser(id) {
  const auth = loadJSON(AUTH_PATH);
  return auth.authorized_users.some(u => u.discord_id === id);
}

function parseCommand(content) {
  const wakeMatch = content.match(/^new wake ?word[:\s]+(.+)/i);
  if (wakeMatch) return { action: 'add_wake_word', phrase: wakeMatch[1].trim() };

  const voiceMatch = content.match(/^new voice[:\s]+([^\n]+?)(?:\s+(https?:\/\/\S+))?$/i);
  if (voiceMatch) return { action: 'add_voice', name: voiceMatch[1].trim(), url: voiceMatch[2] || null };

  if (/^list voices?$/i.test(content.trim())) return { action: 'list_voices' };
  if (/^list wake ?words?$/i.test(content.trim())) return { action: 'list_wake_words' };

  const setVoice = content.match(/^set voice\s+(\S+)/i);
  if (setVoice) return { action: 'set_voice', slug: setVoice[1] };

  const setWake = content.match(/^set wake ?word\s+(\S+)/i);
  if (setWake) return { action: 'set_wake_word', slug: setWake[1] };

  return null;
}
```

## Add a Wake Word

### Step 1: Check if Model Already Exists

```javascript
async function addWakeWord(message, phrase) {
  const slug = slugify(phrase);
  const config = loadJSON(CONFIG_PATH);
  const existing = config.wake_words.find(w => w.slug === slug);

  if (existing) {
    await message.reply(`Wake word **${phrase}** already exists (status: ${existing.status}). Use \`set wake word ${slug}\` to activate it.`);
    return;
  }

  await message.react('⏳');
  await message.reply(`Training wake word **${phrase}**... This takes 5-10 minutes on WatchTower GPU.`);
```

### Step 2: Launch Docker Training on WatchTower

```javascript
  // Train via openWakeWord Docker on WatchTower
  const outputDir = `/mnt/user/appdata/openwakeword/training-${slug}`;
  const modelOutput = `/mnt/user/appdata/openwakeword/models/${slug}.onnx`;

  const trainCmd = [
    `ssh root@10.10.7.55`,
    `"mkdir -p ${outputDir} &&`,
    `docker run --rm --gpus all`,
    `  -v ${outputDir}:/output`,
    `  -v /mnt/user/appdata/openwakeword/models:/models`,
    `  dscripka/openwakeword-training`,
    `  --phrase '${phrase.replace(/'/g, "'\\''")}'`,
    `  --output-dir /output`,
    `  --model-name ${slug}`,
    `  --n-samples 1500`,
    `  --target-accuracy 0.5`,
    `  && cp /output/${slug}.onnx /models/${slug}.onnx`,
    `  && echo TRAINING_COMPLETE"`,
  ].join(' ');

  exec(trainCmd, { timeout: 900000, maxBuffer: 10 * 1024 * 1024 }, async (err, stdout, stderr) => {
    if (err || !stdout.includes('TRAINING_COMPLETE')) {
      await message.channel.send(`Wake word training for **${phrase}** failed:\n\`\`\`\n${(stderr || err?.message || 'unknown error').slice(0, 500)}\n\`\`\``);
      return;
    }
    await postWakeWordApproval(message, slug, phrase, modelOutput);
  });
}
```

### Step 3: Post Approval Message

```javascript
async function postWakeWordApproval(origMessage, slug, phrase, onnxPath) {
  const state = loadJSON(STATE_PATH);
  state.counter++;
  const stateId = `VC-${String(state.counter).padStart(4, '0')}`;

  const msg = await origMessage.channel.send({
    embeds: [{
      title: `Wake Word Ready: "${phrase}"`,
      fields: [
        { name: 'Slug', value: `\`${slug}\``, inline: true },
        { name: 'Model', value: `\`${onnxPath}\``, inline: false },
        { name: 'Status', value: 'Awaiting approval', inline: true }
      ],
      color: 0xffaa00,
      footer: { text: `${stateId} | React ✅ to deploy to Pi` }
    }]
  });
  await msg.react('✅');

  state.pending.push({
    id: stateId, type: 'wake_word', slug, display: phrase,
    discord_message_id: msg.id, discord_channel_id: msg.channel.id,
    author_discord_id: origMessage.author.id,
    created_at: new Date().toISOString(),
    payload: { onnx_path: onnxPath }
  });
  saveJSON(STATE_PATH, state);
}
```

### Step 4: Deploy on Approval

```javascript
async function deployWakeWord(channel, pending) {
  const config = loadJSON(CONFIG_PATH);
  const pi = config.pi;
  const { slug, display, payload } = pending;

  try {
    // Copy ONNX from WatchTower to Pi
    execSync(`ssh root@10.10.7.55 "scp ${payload.onnx_path} ${pi.host}:${pi.models_dir}/${slug}.onnx"`, { timeout: 30000 });

    // Update Pi voice assistant config
    const updateCmd = `ssh ${pi.host} "python3 -c \\"
import json
c = json.load(open('${pi.config_path}'))
c['wake_word']['model'] = '${slug}'
json.dump(c, open('/tmp/va-cfg.json','w'), indent=2)
\\" && mv /tmp/va-cfg.json ${pi.config_path}"`;
    execSync(updateCmd, { timeout: 15000 });

    // Restart service
    execSync(`ssh ${pi.host} "sudo systemctl restart ${pi.service}"`, { timeout: 20000 });

    // Update catalog
    config.wake_words.forEach(w => { if (w.status === 'active') w.status = 'trained'; });
    config.wake_words.push({
      slug, display, model_name: slug, status: 'active',
      threshold: 0.5, added_at: new Date().toISOString()
    });
    saveJSON(CONFIG_PATH, config);

    await channel.send(`Wake word **${display}** deployed! Say "${display}" to test.`);
  } catch (err) {
    await channel.send(`Deploy failed: \`${err.message.slice(0, 400)}\``);
  }
}
```

## Add a Voice

### Step 1: Parse Request and Search for Audio

```javascript
async function addVoice(message, name, url) {
  const slug = slugify(name);
  const config = loadJSON(CONFIG_PATH);
  const existing = config.voices.find(v => v.slug === slug);

  if (existing) {
    await message.reply(`Voice **${name}** already exists (status: ${existing.status}). Use \`set voice ${slug}\` to activate it.`);
    return;
  }

  await message.react('⏳');

  // If no URL provided, search YouTube for character voice
  if (!url) {
    try {
      const searchSlug = slugify(name); // safe for shell
      const searchResult = execSync(
        `ssh ${config.watchtower.host} "yt-dlp --default-search ytsearch1 --print webpage_url 'ytsearch1:${searchSlug} voice lines compilation'"`,
        { encoding: 'utf8', timeout: 30000 }
      ).trim();
      if (searchResult && isValidUrl(searchResult)) {
        url = searchResult;
        await message.reply(`Found audio source for **${name}**: ${url}\nDownloading and processing...`);
      }
    } catch {
      await message.reply(`Could not find YouTube audio for **${name}**. Try providing a URL: \`new voice: ${name} https://youtube.com/...\``);
      return;
    }
  } else if (!isValidUrl(url)) {
    await message.reply(`Invalid URL format. Please provide a valid YouTube URL.`);
    return;
  } else {
    await message.reply(`Processing audio from ${url} for voice **${name}**...`);
  }
```

### Step 2: Download and Extract Clean Speech

```javascript
  const wt = config.watchtower;

  try {
    // Download audio on WatchTower via yt-dlp (-- ends option parsing for safe URL)
    const rawPath = `/tmp/vc-${slug}-raw.wav`;
    execSync(
      `ssh ${wt.host} "yt-dlp --extract-audio --audio-format wav --audio-quality 0 --output '${rawPath}' -- '${url}'"`,
      { timeout: 120000 }
    );

    // Process with ffmpeg: normalize, strip silence, 30s max, 22050Hz mono
    const segmentPath = `/tmp/vc-${slug}-segment.wav`;
    const voiceDest = `${wt.voices_dir}/${slug}.wav`;
    execSync(
      `ssh ${wt.host} "ffmpeg -y -i '${rawPath}' ` +
      `-af 'silenceremove=start_periods=1:start_silence=0.3:start_threshold=-40dB,loudnorm=I=-16:TP=-1.5:LRA=11' ` +
      `-t 30 -ar 22050 -ac 1 '${segmentPath}' && ` +
      `cp '${segmentPath}' '${voiceDest}' && ` +
      `rm -f '${rawPath}' '${segmentPath}'"`,
      { timeout: 60000 }
    );
```

### Step 3: Register in openedai-speech

The container has two config files:
- `/app/config/voice_to_speaker.yaml` — active config loaded at startup
- `/app/voice_to_speaker.default.yaml` — template copied on first run

Custom WAVs go to `/data/voices/` (host mount) AND `/app/voices/` (container). Use the
built-in `add_voice.py` script to register, then back up config to `/data/` for persistence
across container rebuilds.

```javascript
    // Check if voice already registered in the active config
    const grepResult = execSync(
      `ssh ${wt.host} "docker exec openedai-speech grep -c '  ${slug}:' /app/config/voice_to_speaker.yaml 2>/dev/null || echo 0"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();

    if (grepResult === '0') {
      // Copy WAV into the container's voices dir (for runtime)
      execSync(
        `ssh ${wt.host} "docker cp '${voiceDest}' openedai-speech:/app/voices/${slug}.wav"`,
        { timeout: 15000 }
      );

      // Register voice using built-in add_voice.py (updates /app/config/voice_to_speaker.yaml)
      execSync(
        `ssh ${wt.host} "docker exec openedai-speech python /app/add_voice.py /data/voices/${slug}.wav --name ${slug} --language auto"`,
        { timeout: 15000 }
      );

      // Back up active config to persistent host volume
      execSync(
        `ssh ${wt.host} "docker exec openedai-speech cp /app/config/voice_to_speaker.yaml /data/voice_to_speaker.yaml"`,
        { timeout: 10000 }
      );

      // Restart openedai-speech to pick up new voice
      execSync(`ssh ${wt.host} "docker restart openedai-speech"`, { timeout: 30000 });
      // Wait for TTS to be ready
      await new Promise(r => setTimeout(r, 15000));
    }
```

### Step 4: Generate Test Sample and Post for Approval

```javascript
    // Generate test TTS sample
    const testText = `Hello! This is how I sound as ${name}. Pretty cool, right?`;
    const testPath = `/tmp/vc-test-${slug}.wav`;

    const ttsResp = await fetch(`${wt.tts_url}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1-hd', input: testText, voice: slug, response_format: 'wav' })
    });

    if (!ttsResp.ok) throw new Error(`TTS test failed: ${ttsResp.status} ${await ttsResp.text()}`);
    const wavBuf = Buffer.from(await ttsResp.arrayBuffer());
    fs.writeFileSync(testPath, wavBuf);

    // Post approval message with audio sample
    const state = loadJSON(STATE_PATH);
    state.counter++;
    const stateId = `VC-${String(state.counter).padStart(4, '0')}`;

    const msg = await message.channel.send({
      content: `Voice **${name}** cloned! Listen to the test sample below.\nReact ✅ to set as active voice, or ignore to keep available.`,
      embeds: [{
        title: `Voice Ready: ${name}`,
        fields: [
          { name: 'Slug', value: `\`${slug}\``, inline: true },
          { name: 'Source', value: url, inline: false }
        ],
        color: 0xffaa00,
        footer: { text: `${stateId} | React ✅ to activate` }
      }],
      files: [{ attachment: testPath, name: `voice-test-${slug}.wav` }]
    });
    await msg.react('✅');

    state.pending.push({
      id: stateId, type: 'voice_clone', slug, display: name,
      discord_message_id: msg.id, discord_channel_id: msg.channel.id,
      author_discord_id: message.author.id,
      created_at: new Date().toISOString(),
      payload: { source_url: url, wav_path: voiceDest }
    });
    saveJSON(STATE_PATH, state);

    // Add to catalog as available (not active yet)
    config.voices.push({
      slug, display: name, status: 'available', is_builtin: false,
      source_url: url, added_at: new Date().toISOString()
    });
    saveJSON(CONFIG_PATH, config);

  } catch (err) {
    await message.reply(`Voice cloning failed: \`${err.message.slice(0, 400)}\``);
  }
}
```

### Step 5: Activate on Approval

```javascript
async function activateVoice(channel, pending) {
  const config = loadJSON(CONFIG_PATH);
  const pi = config.pi;
  const { slug, display } = pending;

  try {
    // Update Pi TTS config
    const updateCmd = `ssh ${pi.host} "python3 -c \\"
import json
c = json.load(open('${pi.config_path}'))
c['tts']['voice'] = '${slug}'
json.dump(c, open('/tmp/va-cfg.json','w'), indent=2)
\\" && mv /tmp/va-cfg.json ${pi.config_path}"`;
    execSync(updateCmd, { timeout: 15000 });

    // Restart voice assistant
    execSync(`ssh ${pi.host} "sudo systemctl restart ${pi.service}"`, { timeout: 20000 });

    // Update catalog
    config.voices.forEach(v => {
      if (v.status === 'active') v.status = 'available';
      if (v.slug === slug) v.status = 'active';
    });
    saveJSON(CONFIG_PATH, config);

    await channel.send(`Voice **${display}** is now active! The assistant will speak as ${display}.`);
  } catch (err) {
    await channel.send(`Voice activation failed: \`${err.message.slice(0, 400)}\``);
  }
}
```

## List Available

```javascript
async function listVoices(message) {
  const config = loadJSON(CONFIG_PATH);
  const lines = config.voices.map(v =>
    `${v.status === 'active' ? '**[ACTIVE]**' : '         '} \`${v.slug}\` - ${v.display}${v.is_builtin ? ' (built-in)' : ''}`
  );
  await message.reply(`**Available Voices:**\n${lines.join('\n')}`);
}

async function listWakeWords(message) {
  const config = loadJSON(CONFIG_PATH);
  const lines = config.wake_words.map(w =>
    `${w.status === 'active' ? '**[ACTIVE]**' : `  [${w.status}]`} \`${w.slug}\` - "${w.display}" (threshold: ${w.threshold})`
  );
  await message.reply(`**Available Wake Words:**\n${lines.join('\n')}`);
}
```

## Set Active Voice or Wake Word

```javascript
async function setVoice(message, slug) {
  if (!isValidSlug(slug)) { await message.reply('Invalid slug. Use lowercase letters, numbers, and hyphens only.'); return; }
  const config = loadJSON(CONFIG_PATH);
  const voice = config.voices.find(v => v.slug === slug);
  if (!voice) {
    const available = config.voices.map(v => `\`${v.slug}\``).join(', ');
    await message.reply(`Voice \`${slug}\` not found. Available: ${available}`);
    return;
  }

  const pi = config.pi;
  try {
    execSync(`ssh ${pi.host} "python3 -c \\"
import json; c=json.load(open('${pi.config_path}')); c['tts']['voice']='${slug}';
json.dump(c,open('/tmp/va-cfg.json','w'),indent=2)
\\" && mv /tmp/va-cfg.json ${pi.config_path} && sudo systemctl restart ${pi.service}"`, { timeout: 30000 });

    config.voices.forEach(v => {
      if (v.status === 'active') v.status = 'available';
      if (v.slug === slug) v.status = 'active';
    });
    saveJSON(CONFIG_PATH, config);
    await message.reply(`Voice switched to **${voice.display}**. Service restarted.`);
  } catch (err) {
    await message.reply(`Failed: \`${err.message.slice(0, 300)}\``);
  }
}

async function setWakeWord(message, slug) {
  if (!isValidSlug(slug)) { await message.reply('Invalid slug. Use lowercase letters, numbers, and hyphens only.'); return; }
  const config = loadJSON(CONFIG_PATH);
  const ww = config.wake_words.find(w => w.slug === slug);
  if (!ww) {
    const available = config.wake_words.map(w => `\`${w.slug}\``).join(', ');
    await message.reply(`Wake word \`${slug}\` not found. Available: ${available}`);
    return;
  }

  const pi = config.pi;
  try {
    execSync(`ssh ${pi.host} "python3 -c \\"
import json; c=json.load(open('${pi.config_path}')); c['wake_word']['model']='${slug}';
json.dump(c,open('/tmp/va-cfg.json','w'),indent=2)
\\" && mv /tmp/va-cfg.json ${pi.config_path} && sudo systemctl restart ${pi.service}"`, { timeout: 30000 });

    config.wake_words.forEach(w => {
      if (w.status === 'active') w.status = 'trained';
      if (w.slug === slug) w.status = 'active';
    });
    saveJSON(CONFIG_PATH, config);
    await message.reply(`Wake word switched to **${ww.display}**. Service restarted.`);
  } catch (err) {
    await message.reply(`Failed: \`${err.message.slice(0, 300)}\``);
  }
}
```

## Approval Handler

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '✅') return;
  if (!isAuthorizedUser(user.id)) return;

  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  const state = loadJSON(STATE_PATH);
  const pending = state.pending.find(p => p.discord_message_id === reaction.message.id);
  if (!pending) return;
  if (user.id !== pending.author_discord_id) return;

  const channel = reaction.message.channel;

  if (pending.type === 'wake_word') {
    await deployWakeWord(channel, pending);
  } else if (pending.type === 'voice_clone') {
    await activateVoice(channel, pending);
  }

  // Remove from pending
  state.pending = state.pending.filter(p => p.id !== pending.id);
  saveJSON(STATE_PATH, state);
});
```

## Bot Registration

```javascript
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});

client.once('ready', () => {
  const state = loadJSON(STATE_PATH);
  console.log(`[voice-customizer] Online. ${state.pending.length} pending approvals.`);
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'voice-customizer') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const cmd = parseCommand(message.content);
  if (!cmd) return;

  switch (cmd.action) {
    case 'add_wake_word': await addWakeWord(message, cmd.phrase); break;
    case 'add_voice': await addVoice(message, cmd.name, cmd.url); break;
    case 'list_voices': await listVoices(message); break;
    case 'list_wake_words': await listWakeWords(message); break;
    case 'set_voice': await setVoice(message, cmd.slug); break;
    case 'set_wake_word': await setWakeWord(message, cmd.slug); break;
  }
});

const botConfig = loadJSON(BOT_PATH);
client.login(botConfig.token);
```

## Troubleshooting

### Wake Word Training Fails

```bash
# Verify GPU access on WatchTower (remove --gpus all for CPU fallback, ~30 min)
ssh root@10.10.7.55 "docker run --rm --gpus all nvidia/cuda:12.0-base-ubuntu22.04 nvidia-smi"
# Check training logs
ssh root@10.10.7.55 "cat /mnt/user/appdata/openwakeword/training-*/train.log 2>/dev/null"
```

### yt-dlp Audio Extraction Fails

```bash
# Update yt-dlp first — YouTube changes break it frequently
ssh root@10.10.7.55 "curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp"
# Test extraction
ssh root@10.10.7.55 "yt-dlp --extract-audio --audio-format wav -o '/tmp/test.wav' 'https://www.youtube.com/watch?v=TESTID'"
```

### openedai-speech Does Not Recognize New Voice

```bash
# Verify WAV exists in BOTH locations
ssh root@10.10.7.55 "docker exec openedai-speech ls /app/voices/slug-name.wav"
ssh root@10.10.7.55 "ls /mnt/user/appdata/openedai-speech/voices/slug-name.wav"

# Verify YAML entry in the ACTIVE config (not the default!)
ssh root@10.10.7.55 "docker exec openedai-speech grep -A3 'slug-name' /app/config/voice_to_speaker.yaml"

# If missing from active config, re-register with add_voice.py
ssh root@10.10.7.55 "docker exec openedai-speech python /app/add_voice.py /data/voices/slug-name.wav --name slug-name --language auto"

# Restart container to reload config
ssh root@10.10.7.55 "docker restart openedai-speech"

# After container rebuild, restore config backup from host volume
ssh root@10.10.7.55 "docker exec openedai-speech cp /data/voice_to_speaker.yaml /app/config/voice_to_speaker.yaml"
ssh root@10.10.7.55 "docker restart openedai-speech"

# Test TTS directly
curl -s http://10.10.7.55:8022/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"tts-1-hd","input":"Hello world","voice":"slug-name","response_format":"wav"}' \
  -o /tmp/test.wav && afplay /tmp/test.wav
```

### SSH Permission Denied

```bash
# Verify key auth (if this hangs, run ssh-copy-id from Prerequisites)
ssh -v pi@10.10.7.15 "echo ok" && ssh -v root@10.10.7.55 "echo ok"
```

## Tips

- Use two-word wake word phrases for best accuracy (e.g. "hey kitchen", "okay claw"). Single words produce more false positives with openWakeWord.
- XTTS v2 voice cloning needs 6-30 seconds of clean, single-speaker audio. Shorter clips sound robotic; longer clips are silently truncated. The ffmpeg pipeline trims to 30 seconds automatically.
- After cloning a character voice, the kids can switch voices with `set voice slug-name` in Discord. No need to re-clone — all voices stay available.
- The openedai-speech container loads voices from `/app/config/voice_to_speaker.yaml` at startup. Use the built-in `add_voice.py` to register new voices. After any change, back up the config to `/data/voice_to_speaker.yaml` so it survives container rebuilds. Also copy custom WAVs to both `/data/voices/` (persistent mount) and `/app/voices/` (runtime).
- Wake word ONNX models are tiny (~200KB). Store all trained models on the Pi in `~/voice-assistant/models/` even if not active, so switching is instant.
- yt-dlp breaks frequently when YouTube changes its API. If downloads fail, update yt-dlp on WatchTower before debugging anything else.
- The approval gate prevents accidental deployments. Only the user who initiated the request can approve with ✅ — other users' reactions are ignored.
- Test new voices with `curl` against the TTS endpoint before deploying to the Pi. This catches XTTS errors without disrupting the live assistant.
- For best voice cloning results, find YouTube clips with clear dialogue and minimal background music. Movie trailer voice-overs and character compilations work well.
- WatchTower is Unraid (Slackware-based) — no `apt-get`. Use static binaries or Docker for tools. yt-dlp and ffmpeg are installed at `/usr/local/bin/`.
