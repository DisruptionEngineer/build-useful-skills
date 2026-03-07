---
name: nano-banana
description: Generate and edit images via Google Gemini in Discord's #nano-banana channel. Use when creating images from text prompts, editing uploaded images with natural language instructions, generating style variations, browsing a gallery of past generations, or applying preset styles like cinematic, anime, photorealistic, sketch, or pixel-art.
metadata: {"clawdbot":{"emoji":"🍌","requires":{"anyBins":["node"]},"os":["linux","darwin"]}}
---

# Nano Banana — Gemini Image Generation

Generate, edit, and restyle images using Google Gemini's native image generation. All interactions happen in Discord's `#nano-banana` channel — type a prompt, get an image back. Supports style presets, image editing via attachment, variations, and a searchable gallery of past generations.

## When to Use

- Generating an image from a text description
- Applying a style preset (cinematic, anime, pixel-art, etc.) to a prompt
- Editing an uploaded image with natural language instructions
- Creating variations of a previously generated image
- Browsing or retrieving past generations from the gallery
- Listing available style presets
- Generating assets for social media, branding, or creative projects

## Prerequisites

### API Key

Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and add it to the config file.

```bash
# Install the Gemini SDK
cd ~/.agents && npm install @google/generative-ai
```

### Config File

Store the API key and style presets in `~/.agents/config/nano-banana-config.json`:

```json
{
  "geminiApiKey": "AIzaSy...",
  "model": "gemini-2.0-flash-exp-image-generation",
  "defaultAspectRatio": "1:1",
  "maxDailyGenerations": 50,
  "stylePresets": {
    "cinematic": "cinematic film still, dramatic lighting, shallow depth of field, 35mm film grain",
    "anime": "anime art style, cel-shaded, vibrant colors, Studio Ghibli inspired, clean linework",
    "photorealistic": "photorealistic, DSLR photograph, sharp focus, natural lighting, 8K resolution",
    "sketch": "pencil sketch, hand-drawn, crosshatching, charcoal on paper, fine detail, graphite",
    "pixel-art": "pixel art, 16-bit retro style, limited color palette, crisp pixels, nostalgic game aesthetic",
    "watercolor": "watercolor painting, soft washes, bleeding edges, paper texture, translucent layers",
    "oil-painting": "oil painting, thick brushstrokes, rich color, impasto technique, gallery quality",
    "comic": "comic book panel, bold outlines, halftone dots, dynamic action pose",
    "vaporwave": "vaporwave aesthetic, neon pink and cyan, 80s retro, glitch effects",
    "isometric": "isometric 3D render, low-poly, pastel colors, miniature diorama, clean geometric shapes"
  }
}
```

### Data Directories

```bash
# Create assets directory for saved images
mkdir -p ~/.agents/assets/nano-banana

# Initialize history file
echo '{"generations":[],"counter":0,"dailyCounts":{}}' > ~/.agents/data/nano-banana-history.json
```

## Command Reference

| Command | Example | Description |
|---------|---------|-------------|
| `imagine:` | `imagine: a cat in space` | Text-to-image |
| `style:` | `style: cinematic a sunset` | Generate with style preset |
| `edit:` | `edit: make the sky purple` + attached image | Edit an uploaded image |
| `vary: NB-XXXX` | `vary: NB-0001` | Variation of past generation |
| `gallery` | `gallery 2` | Browse saved images (paginated) |
| `history NB-XXXX` | `history NB-0003` | View details of a generation |
| `styles` | `styles` | List available presets |
| `help` | `help` | Show command reference |

## Shared Utilities

Load config, history, and check authorization:

```javascript
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.env.HOME, '.agents/config/nano-banana-config.json');
const HISTORY_PATH = path.join(process.env.HOME, '.agents/data/nano-banana-history.json');
const ASSETS_DIR = path.join(process.env.HOME, '.agents/assets/nano-banana');
const AUTH_PATH = path.join(process.env.HOME, '.agents/config/authorized-users.json');
const BOT_PATH = path.join(process.env.HOME, '.agents/config/discord-bot.json');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveJSON(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}
function isAuthorizedUser(userId) {
  try {
    const auth = loadJSON(AUTH_PATH);
    return auth.authorized_users?.some(u => u.discord_id === userId) || false;
  } catch { return false; }
}
```

## Command Parser

Parse Discord messages into structured commands:

```javascript
const COMMANDS = {
  imagine: /^imagine:\s*(.+)/is,
  edit:    /^edit:\s*(.+)/is,
  vary:    /^vary:\s*(NB-\d{4})/i,
  style:   /^style:\s*(\w[\w-]*)\s+(.+)/is,
  gallery: /^gallery(?:\s+(\d+))?$/i,
  history: /^history(?:\s+(NB-\d{4}))?$/i,
  styles:  /^styles$/i,
  help:    /^help$/i
};

function parseCommand(content) {
  for (const [action, pattern] of Object.entries(COMMANDS)) {
    const match = content.match(pattern);
    if (match) {
      switch (action) {
        case 'imagine': return { action, prompt: match[1].trim() };
        case 'edit':    return { action, prompt: match[1].trim() };
        case 'vary':    return { action, generationId: match[1] };
        case 'style':   return { action, preset: match[1].toLowerCase(), prompt: match[2].trim() };
        case 'gallery': return { action, page: parseInt(match[1] || '1') };
        case 'history': return { action, id: match[1] || null };
        case 'styles':  return { action };
        case 'help':    return { action };
      }
    }
  }
  return null;
}
```

## Text-to-Image Generation

Core image generation using the Gemini API with native image output:

```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

async function generateImage(message, prompt, stylePreset = null) {
  const config = loadJSON(CONFIG_PATH);
  const history = loadJSON(HISTORY_PATH);

  // Rate limit check
  const today = new Date().toISOString().split('T')[0];
  const todayCount = history.dailyCounts[today] || 0;
  if (todayCount >= config.maxDailyGenerations) {
    await message.reply(`Daily limit reached (${config.maxDailyGenerations}). Try again tomorrow.`);
    return;
  }

  await message.react('⏳');

  // Build prompt with optional style
  let fullPrompt = prompt;
  if (stylePreset && config.stylePresets[stylePreset]) {
    fullPrompt = `${prompt}, ${config.stylePresets[stylePreset]}`;
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.model,
    generationConfig: { responseModalities: ['Text', 'Image'] }
  });

  try {
    const result = await model.generateContent(fullPrompt);
    const parts = result.response.candidates[0].content.parts;

    let imageBuffer = null;
    let textResponse = '';

    for (const part of parts) {
      if (part.text) textResponse = part.text;
      else if (part.inlineData) {
        imageBuffer = Buffer.from(part.inlineData.data, 'base64');
      }
    }

    if (!imageBuffer) {
      await message.reactions.cache.get('⏳')?.remove().catch(() => {});
      await message.reply('Gemini did not return an image. Try rephrasing your prompt.');
      return;
    }

    const genId = saveGeneration(history, prompt, stylePreset, imageBuffer, message.author.id);
    await postImageEmbed(message, genId, prompt, stylePreset, imageBuffer, textResponse);
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove().catch(() => {});
    await message.reply(`Generation failed: \`${err.message.slice(0, 300)}\``);
  }
}
```

### Save Generation to Disk

```javascript
function saveGeneration(history, prompt, style, imageBuffer, authorId) {
  history.counter++;
  const genId = `NB-${String(history.counter).padStart(4, '0')}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const filename = `${genId}-${timestamp}.png`;
  const filePath = path.join(ASSETS_DIR, filename);

  fs.writeFileSync(filePath, imageBuffer);

  const today = new Date().toISOString().split('T')[0];
  history.dailyCounts[today] = (history.dailyCounts[today] || 0) + 1;

  history.generations.push({
    id: genId,
    type: style ? 'styled' : 'text-to-image',
    prompt,
    style: style || null,
    filePath,
    authorId,
    createdAt: new Date().toISOString()
  });

  saveJSON(HISTORY_PATH, history);
  return genId;
}
```

### Discord Embed Response

Post the generated image as a Discord embed with file attachment:

```javascript
async function postImageEmbed(message, genId, prompt, style, imageBuffer, textResponse) {
  const attachment = new AttachmentBuilder(imageBuffer, { name: `${genId}.png` });

  const embed = new EmbedBuilder()
    .setTitle(genId)
    .setDescription(prompt.length > 200 ? prompt.slice(0, 197) + '...' : prompt)
    .setImage(`attachment://${genId}.png`)
    .setColor(0xFFD700)
    .setFooter({ text: `Style: ${style || 'none'} | React 🔄 to vary` })
    .setTimestamp();

  if (textResponse) {
    embed.addFields({ name: 'Gemini Note', value: textResponse.slice(0, 200), inline: false });
  }

  await message.reactions.cache.get('⏳')?.remove().catch(() => {});
  const reply = await message.reply({ embeds: [embed], files: [attachment] });
  await reply.react('🔄');

  // Store message ID for variation lookups
  const history = loadJSON(HISTORY_PATH);
  const gen = history.generations.find(g => g.id === genId);
  if (gen) {
    gen.discordMessageId = reply.id;
    saveJSON(HISTORY_PATH, history);
  }
}
```

## Style Presets

### List Styles

```javascript
async function listStyles(message) {
  const config = loadJSON(CONFIG_PATH);
  const names = Object.keys(config.stylePresets);
  const lines = names.map(name => `**${name}** — ${config.stylePresets[name].slice(0, 60)}...`);
  await message.reply([
    '**Available Style Presets**',
    '',
    ...lines,
    '',
    'Usage: `style: cinematic a sunset over mountains`'
  ].join('\n'));
}
```

## Image Editing

Upload an image attachment with an `edit:` command. The image is sent to Gemini as multimodal input alongside the instruction.

```javascript
async function editImage(message, prompt) {
  const attachment = message.attachments.first();
  if (!attachment) {
    await message.reply('Attach an image to edit. Usage: `edit: make the sky purple` with an attached image.');
    return;
  }
  if (!attachment.contentType?.startsWith('image/')) {
    await message.reply('Attachment must be an image (PNG, JPG, WEBP).');
    return;
  }

  await message.react('⏳');

  try {
    const response = await fetch(attachment.url);
    const arrayBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = attachment.contentType || 'image/png';

    const config = loadJSON(CONFIG_PATH);
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: config.model,
      generationConfig: { responseModalities: ['Text', 'Image'] }
    });

    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: base64Image } }
    ]);

    const parts = result.response.candidates[0].content.parts;
    let imageBuffer = null;
    let textResponse = '';

    for (const part of parts) {
      if (part.text) textResponse = part.text;
      else if (part.inlineData) {
        imageBuffer = Buffer.from(part.inlineData.data, 'base64');
      }
    }

    if (!imageBuffer) {
      await message.reactions.cache.get('⏳')?.remove().catch(() => {});
      await message.reply('Gemini did not return an edited image. Try a different instruction.');
      return;
    }

    const history = loadJSON(HISTORY_PATH);
    const genId = saveGeneration(history, `[edit] ${prompt}`, null, imageBuffer, message.author.id);
    await postImageEmbed(message, genId, `[edit] ${prompt}`, null, imageBuffer, textResponse);
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove().catch(() => {});
    await message.reply(`Edit failed: \`${err.message.slice(0, 300)}\``);
  }
}
```

## Variations

React with 🔄 on any generated image to create a variation. Gemini naturally produces different outputs for the same prompt.

### Reaction Handler

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '🔄') return;
  if (reaction.message.channel.name !== 'nano-banana') return;
  if (!isAuthorizedUser(user.id)) return;

  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  if (reaction.message.partial) { try { await reaction.message.fetch(); } catch { return; } }

  const history = loadJSON(HISTORY_PATH);
  const gen = history.generations.find(g => g.discordMessageId === reaction.message.id);
  if (!gen) return;

  await generateImage(reaction.message, gen.prompt, gen.style);
});
```

### Vary by ID

Use `vary: NB-0001` to regenerate from a specific generation ID without needing the original message:

```javascript
async function regenerateVariation(message, generationId) {
  const history = loadJSON(HISTORY_PATH);
  const gen = history.generations.find(g => g.id === generationId);
  if (!gen) {
    await message.reply(`Generation \`${generationId}\` not found. Use \`gallery\` to see available IDs.`);
    return;
  }
  await generateImage(message, gen.prompt, gen.style);
}
```

## Gallery & History

### Browse Gallery

Paginated list of past generations, newest first:

```javascript
async function showGallery(message, page) {
  const history = loadJSON(HISTORY_PATH);
  const perPage = 5;
  const total = history.generations.length;
  if (total === 0) {
    await message.reply('No generations yet. Try `imagine: a sunset over mountains`');
    return;
  }

  const totalPages = Math.ceil(total / perPage);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * perPage;
  const items = [...history.generations].reverse().slice(start, start + perPage);

  const lines = items.map(g => {
    const date = new Date(g.createdAt).toLocaleDateString();
    const truncPrompt = g.prompt.slice(0, 50) + (g.prompt.length > 50 ? '...' : '');
    return `\`${g.id}\` | ${g.type} | ${truncPrompt} | ${date}`;
  });

  await message.reply([
    `**Gallery** (page ${safePage}/${totalPages}, ${total} total)`,
    ...lines,
    '',
    `Use \`history NB-XXXX\` to view details or \`vary: NB-XXXX\` to regenerate.`
  ].join('\n'));
}
```

### View Generation Details

```javascript
async function showHistory(message, id) {
  const history = loadJSON(HISTORY_PATH);

  if (!id) {
    const last5 = history.generations.slice(-5).reverse();
    const lines = last5.map(g => `\`${g.id}\` — ${g.prompt.slice(0, 60)}`);
    await message.reply(['**Recent Generations**', ...lines, '', 'Use `history NB-XXXX` for details.'].join('\n'));
    return;
  }

  const gen = history.generations.find(g => g.id === id);
  if (!gen) {
    await message.reply(`Generation \`${id}\` not found.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(gen.id)
    .addFields(
      { name: 'Prompt', value: gen.prompt.slice(0, 1024), inline: false },
      { name: 'Type', value: gen.type, inline: true },
      { name: 'Style', value: gen.style || 'none', inline: true },
      { name: 'Created', value: new Date(gen.createdAt).toLocaleString(), inline: true }
    )
    .setColor(0xFFD700);

  // Attach saved image if it still exists on disk
  if (gen.filePath && fs.existsSync(gen.filePath)) {
    const attachment = new AttachmentBuilder(gen.filePath, { name: `${gen.id}.png` });
    embed.setImage(`attachment://${gen.id}.png`);
    await message.reply({ embeds: [embed], files: [attachment] });
  } else {
    embed.addFields({ name: 'File', value: 'Image file no longer on disk.', inline: false });
    await message.reply({ embeds: [embed] });
  }
}
```

## Help Command

```javascript
async function showHelp(message) {
  await message.reply([
    '**Nano Banana — Commands**',
    '`imagine: <prompt>` — Generate an image',
    '`style: <preset> <prompt>` — Generate with style preset',
    '`edit: <instruction>` + attached image — Edit an image',
    '`vary: NB-XXXX` — Regenerate a variation',
    '`gallery [page]` — Browse saved images',
    '`history [NB-XXXX]` — View generation details',
    '`styles` — List available presets',
    '`help` — This message',
    '',
    'React 🔄 on any generated image for a quick variation.'
  ].join('\n'));
}
```

## Error Handling & Rate Limits

Handle common Gemini API errors gracefully:

```javascript
// Wrap generateContent calls with error classification
function classifyError(err) {
  const msg = err.message || '';
  if (msg.includes('429') || msg.includes('quota')) return 'Rate limited — wait a minute and try again.';
  if (msg.includes('400') || msg.includes('INVALID')) return 'Invalid prompt — try rephrasing.';
  if (msg.includes('403') || msg.includes('permission')) return 'API key issue — check config.';
  if (msg.includes('safety')) return 'Prompt blocked by safety filters — try a different prompt.';
  return `Unexpected error: \`${msg.slice(0, 200)}\``;
}
```

## Bot Registration

Wire up the Discord client with all handlers:

```javascript
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'nano-banana') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const cmd = parseCommand(message.content);
  if (!cmd) return;

  switch (cmd.action) {
    case 'imagine': await generateImage(message, cmd.prompt); break;
    case 'style':   await generateImage(message, cmd.prompt, cmd.preset); break;
    case 'edit':    await editImage(message, cmd.prompt); break;
    case 'vary':    await regenerateVariation(message, cmd.generationId); break;
    case 'gallery': await showGallery(message, cmd.page); break;
    case 'history': await showHistory(message, cmd.id); break;
    case 'styles':  await listStyles(message); break;
    case 'help':    await showHelp(message); break;
  }
});

// Reaction handler for variations (defined in Variations section above)

const botConfig = loadJSON(BOT_PATH);
client.login(botConfig.token);
```

## Tips

- Free Gemini API allows ~15 requests per minute — space out batch generations or add a short delay between requests
- Style presets are additive — they append to your prompt, so short prompts + detailed presets produce the best results
- Image editing works best with specific instructions ("change the sky to sunset orange") rather than vague ones ("make it better")
- The `gemini-2.0-flash-exp-image-generation` model name may change as Google promotes it — update the `model` field in config when needed
- Generated images are saved with IDs like `NB-0001` — clean up `~/.agents/assets/nano-banana/` periodically if disk space matters
- Attach a PNG or JPG for `edit:` — WEBP works too but GIF may not be fully supported
- Style presets live in the config file — add, remove, or customize them without modifying the skill
- The 🔄 reaction on any bot reply triggers a variation — same prompt, different result each time
