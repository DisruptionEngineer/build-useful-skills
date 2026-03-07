---
name: openclaw-skill-forge
description: Fully automated Discord-to-SKILL.md pipeline that takes a raw skill idea posted in #skill-forge, auto-refines it into a structured spec, invokes the OpenClaw agent CLI to write the complete SKILL.md file, validates the output, and installs it under ~/.agents/skills/. Use when rapidly forging new skills without a human confirmation loop, routing pipeline BUILD_SKILL messages directly to code, or replacing the manual prompt-refiner and skill-factory two-step with a single automated forge run. Posts a confirmation embed and notifies #skill-registry on success.
metadata: {"clawdbot":{"emoji":"⚒️","requires":{"anyBins":["node","jq","openclaw"]},"os":["linux","darwin"]}}
---

# OpenClaw Skill Forge

Listen on `#skill-forge` for raw skill ideas or pipeline-forwarded `BUILD_SKILL` messages. Auto-refine the description into a structured spec, invoke `openclaw agent --message '...' --json` with full skill-writer guidelines, validate the generated SKILL.md, write it to `~/.agents/skills/{slug}/SKILL.md` atomically, post a color-coded embed with build stats, update `idea-backlog.json` to `forged`, and notify `#skill-registry` via `[SYSTEM] NEW_SKILL`. No human confirmation step.

## When to Use

- A user posts a skill idea directly in `#skill-forge` and wants it built without a refinement loop
- The pipeline forwards a `[SYSTEM] BUILD_SKILL IDEA-XXXX` message from `#prompt-refiner` or `#skill-factory`
- Rapidly prototyping a skill from a clear, well-scoped description
- Replacing the two-step `discord-prompt-refiner` + `discord-skill-factory` flow with a single automated run
- Forging a skill from a backlog entry that already has a `refined_prompt` field

## Prerequisites

```bash
# Verify shared bot token, openclaw CLI, and authorized users
cat ~/.agents/config/discord-bot.json | jq -r '.token'
openclaw --version
cat ~/.agents/config/authorized-users.json | jq '.authorized_users | length'

# Initialize data files if absent
[ -f ~/.agents/data/idea-backlog.json ] || echo '{"ideas": []}' > ~/.agents/data/idea-backlog.json
[ -f ~/.agents/data/prompt-templates.json ] || echo '{"templates": []}' > ~/.agents/data/prompt-templates.json

# Verify skill-writer is installed (embedded in agent prompt)
ls ~/.agents/skills/skill-writer/SKILL.md
mkdir -p ~/.agents/skills
```

Bot needs `READ_MESSAGES`, `SEND_MESSAGES`, `ADD_REACTIONS` in `#skill-forge` and `#skill-registry`.

## Bot Initialization and Message Listener

```javascript
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { Client, GatewayIntentBits } = require('discord.js');

const SKILLS_DIR     = path.join(process.env.HOME, '.agents', 'skills');
const BACKLOG_PATH   = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');
const TEMPLATES_PATH = path.join(process.env.HOME, '.agents', 'data', 'prompt-templates.json');
const AUTH_PATH      = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

function isAuthorizedUser(discordId) {
  try {
    const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return config.authorized_users.some(u => u.discord_id === discordId);
  } catch { return false; }
}

client.once('ready', () => console.log(`[skill-forge] Online as ${client.user.tag}, watching #skill-forge`));

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'skill-forge') return;

  // Accept BUILD_SKILL system messages from the bot itself
  const systemMatch = message.content.match(/\[SYSTEM\] BUILD_SKILL (IDEA-\d{4})/);
  if (systemMatch && message.author.bot && message.author.id === client.user.id) {
    await runForge(message.channel, systemMatch[1], null);
    return;
  }

  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  if (message.content.trim().length < 20) {
    await message.react('❓');
    await message.reply('Description too short. Provide at least a sentence describing the skill.');
    return;
  }

  await runForge(message.channel, null, message.content.trim());
});

const botConfig = loadJSON(path.join(process.env.HOME, '.agents', 'config', 'discord-bot.json'));
if (!botConfig?.token) { console.error('[skill-forge] Missing or unreadable discord-bot.json'); process.exit(1); }
client.login(botConfig.token);
```

## Main Forge Orchestrator

For pipeline messages, load `refined_prompt` from `idea-backlog.json`. For direct messages, use the raw text. Retries once with strict mode on failure.

```javascript
async function runForge(channel, ideaId, directText) {
  try {
    await channel.send(`⚒️ Forging skill${ideaId ? ` for **${ideaId}**` : ''}... This takes 2-5 minutes.`);
    let rawInput;

    if (ideaId) {
      const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
      const idea = backlog.ideas.find(i => i.id === ideaId);
      if (!idea) { await postEmbed(channel, 'error', ideaId, [`Idea **${ideaId}** not found in backlog.`]); return; }
      if (idea.status === 'forged') {
        await postEmbed(channel, 'warning', ideaId, [
          `**${ideaId}** already forged as \`${idea.skill_slug}\` on ${idea.forged_at}. Delete existing skill to re-forge.`
        ]);
        return;
      }
      rawInput = idea.refined_prompt || idea.raw_text;
    } else {
      rawInput = directText;
    }

    const spec = await autoRefine(rawInput);
    const slug = deriveSlug(spec);

    // Check for slug collision
    if (fs.existsSync(path.join(SKILLS_DIR, slug))) {
      await postEmbed(channel, 'warning', ideaId || slug, [
        `\`~/.agents/skills/${slug}/\` already exists. Delete or rename before forging.`
      ]);
      return;
    }

    // Invoke OpenClaw agent — retry once with strict mode on failure
    let skillMdContent = null;
    let validation = null;

    for (const strict of [false, true]) {
      if (strict) await channel.send('First attempt failed. Retrying with strict prompt...');
      try {
        const output = await invokeForgeAgent(slug, spec, strict);
        const content = extractSkillMd(output, slug);
        if (!content) continue;
        validation = validateSkillMd(content);
        if (validation.valid) { skillMdContent = content; break; }
        if (!strict) skillMdContent = content; // hold for error reporting
      } catch (err) {
        if (!strict) { await postEmbed(channel, 'error', ideaId, [`Agent failed: ${err.message.slice(0, 300)}`]); return; }
      }
    }

    if (!skillMdContent || !validation?.valid) {
      cleanupPartialSkill(slug);
      const msgs = ['Generation failed after retry.'];
      if (validation?.errors) msgs.push(...validation.errors.map(e => `- ${e}`));
      await postEmbed(channel, 'error', ideaId, msgs);
      return;
    }

    await finalizeForge(channel, ideaId, slug, skillMdContent, validation);
  } catch (err) {
    console.error('[skill-forge] runForge error:', err);
    await postEmbed(channel, 'error', ideaId, [`Unexpected error: ${err.message}`]);
  }
}
```

## Auto-Refine Raw Input into Structured Spec

Converts a raw description into a structured spec. Pulls a matching template from `prompt-templates.json` if one exists.

```javascript
async function autoRefine(rawText) {
  const template = findMatchingTemplate(rawText);
  const scaffoldNote = template
    ? `\n\nUse this template as a scaffold (adapt, do not copy verbatim):\n${JSON.stringify(template.template, null, 2)}`
    : '';

  const prompt = `Expand this raw skill idea into a complete, structured skill specification.

Raw idea: "${rawText}"

Generate exactly these sections:
1. **name:** — the skill slug: lowercase, hyphenated, 1-3 words
2. **description:** — one sentence starting with a verb, includes specific trigger phrases
3. **When to Use** — 4-6 trigger scenarios starting with gerunds
4. **Instruction Outline** — 5-8 numbered imperative steps
5. **Edge Cases** — 3-5 specific failure modes${scaffoldNote}

Return the result in this exact markdown format. Do not add extra sections.`;

  const escaped = prompt.replace(/'/g, "'\\''");
  const { stdout: result } = await execAsync(
    `openclaw agent --message '${escaped}' --json --thinking low --timeout 60`,
    { encoding: 'utf8', timeout: 90_000, maxBuffer: 5 * 1024 * 1024 }
  );

  return parseAgentJson(result);
}

function findMatchingTemplate(rawText) {
  try {
    const library = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    const keywords = rawText.toLowerCase().split(/\s+/);
    const patternKeywords = {
      'discord-listener': ['listen', 'channel', 'discord', 'message', 'watch', 'bot'],
      'cron-job':         ['schedule', 'cron', 'weekly', 'daily', 'periodic', 'every'],
      'file-watcher':     ['watch', 'file', 'directory', 'change', 'modify'],
      'api-webhook':      ['webhook', 'api', 'endpoint', 'http', 'post'],
      'data-pipeline':    ['transform', 'pipeline', 'process', 'convert', 'parse']
    };
    let bestMatch = null, bestScore = 0;
    for (const tpl of library.templates) {
      const overlap = keywords.filter(k => (patternKeywords[tpl.pattern] || []).includes(k)).length;
      if (overlap > bestScore) { bestScore = overlap; bestMatch = tpl; }
    }
    return bestScore >= 2 ? bestMatch : null;
  } catch { return null; }
}
```

## Derive Skill Slug

```javascript
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
}

function deriveSlug(refinedSpec) {
  const nameMatch = refinedSpec.match(/\*\*name:\*\*\s*([a-z0-9-]+)/i);
  if (nameMatch) return slugify(nameMatch[1]);

  const descMatch = refinedSpec.match(/\*\*description:\*\*\s*(.+?)(?:\n|$)/i);
  if (descMatch) {
    const stopWords = new Set(['the','a','an','on','in','for','and','to','of','with','from','via']);
    const words = descMatch[1].replace(/[^a-zA-Z\s]/g, '').split(/\s+/)
      .filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3);
    return slugify(words.join(' '));
  }
  return slugify(refinedSpec.split('\n')[0].substring(0, 40));
}
```

## Invoke the OpenClaw Agent

Build a prompt embedding skill-writer guidelines, the refined spec, target path, and explicit write instruction. Pattern: `openclaw agent --message '...' --json --thinking medium --timeout 300`.

```javascript
async function invokeForgeAgent(slug, refinedSpec, strict = false) {
  const skillWriterContent = fs.readFileSync(path.join(SKILLS_DIR, 'skill-writer', 'SKILL.md'), 'utf8');
  const targetPath = path.join(SKILLS_DIR, slug, 'SKILL.md');

  const strictClause = strict
    ? `\n\nSTRICT MODE: Include ALL required frontmatter (name, description, metadata), ` +
      `code blocks in EVERY section, Tips with 5+ bullets, 350-550 lines total, ` +
      `output wrapped in a \`\`\`skill-md fence.\n`
    : '';

  const agentMessage =
    `You are writing a new OpenClaw skill file. Follow the skill-writer guidelines precisely.\n\n` +
    `## Skill-Writer Guidelines\n\n${skillWriterContent}\n\n---\n\n` +
    `## Skill Specification to Implement\n\n${refinedSpec}\n\n---\n\n` +
    `## Your Task\n\n` +
    `1. Generate a complete, valid SKILL.md for slug: \`${slug}\`\n` +
    `2. Follow ALL skill-writer guidelines: valid YAML frontmatter, "When to Use", code blocks in every section, 5-10 Tips, 300-550 lines.\n` +
    `3. mkdir -p ${path.dirname(targetPath)} and write to: ${targetPath}\n` +
    `4. Output the complete content wrapped in a \`\`\`skill-md fence.` +
    strictClause;

  const escaped = agentMessage.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `openclaw agent --message '${escaped}' --json --thinking medium --timeout 300`,
    { encoding: 'utf8', timeout: 330_000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}
```

## Parse Agent JSON and Extract SKILL.md

Shared JSON parser used by both `autoRefine` and `extractSkillMd`. Four fallback extraction strategies: skill-md fence, markdown fence, raw frontmatter, and reading from disk.

```javascript
function parseAgentJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed.result || parsed.content || parsed.text || parsed.output || raw;
  } catch {
    const i = raw.indexOf('{');
    if (i >= 0) {
      try { const p = JSON.parse(raw.slice(i)); return p.result || p.content || raw; }
      catch { return raw; }
    }
    return raw;
  }
}

function extractSkillMd(agentOutput, slug) {
  const text = parseAgentJson(agentOutput);

  // Strategy 1: explicit skill-md fence
  const s1 = text.match(/```skill-md\n([\s\S]*?)```/);
  if (s1) return s1[1].trim();

  // Strategy 2: markdown fence containing frontmatter
  const s2 = text.match(/```(?:markdown|md|yaml)?\n(---[\s\S]*?)```/);
  if (s2) return s2[1].trim();

  // Strategy 3: raw frontmatter in output
  const s3 = text.match(/(---\n[\s\S]*?\n---[\s\S]+)/);
  if (s3) return s3[1].trim();

  // Strategy 4: agent wrote the file directly
  const targetPath = path.join(SKILLS_DIR, slug, 'SKILL.md');
  if (fs.existsSync(targetPath)) return fs.readFileSync(targetPath, 'utf8');

  return null;
}
```

## Validate Generated SKILL.md

Seven-point validation gate. Returns errors (blocking) and warnings (non-blocking).

```javascript
function validateSkillMd(content) {
  const errors = [], warnings = [];

  // 1. Frontmatter
  if (!content.startsWith('---')) errors.push('Missing opening frontmatter delimiter');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    errors.push('Malformed or unclosed frontmatter block');
  } else {
    const fm = fmMatch[1];
    if (!/^name:/m.test(fm))        errors.push('Frontmatter missing `name`');
    if (!/^description:/m.test(fm)) errors.push('Frontmatter missing `description`');
    if (!/^metadata:/m.test(fm))    errors.push('Frontmatter missing `metadata`');
    const metaMatch = fm.match(/^metadata:\s*(.+)$/m);
    if (metaMatch) { try { JSON.parse(metaMatch[1]); } catch { errors.push('`metadata` not valid JSON'); } }
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (descMatch && /^(this skill|a skill)/i.test(descMatch[1].trim()))
      warnings.push('`description` should start with a verb, not "This skill"');
  }

  // 2. Required sections
  if (!/^## When to Use/m.test(content)) errors.push('Missing "## When to Use"');
  if (!/^## Tips/m.test(content))         errors.push('Missing "## Tips"');

  // 3. Code blocks (target 15-40, minimum 8)
  const codeBlocks = Math.floor((content.match(/```/g) || []).length / 2);
  if (codeBlocks < 8)       errors.push(`Only ${codeBlocks} code blocks (min 8)`);
  else if (codeBlocks < 15) warnings.push(`${codeBlocks} code blocks (target 15-40)`);

  // 4. Line count (target 300-550)
  const lines = content.split('\n').length;
  if (lines < 150)      errors.push(`Only ${lines} lines (min 150)`);
  else if (lines < 300) warnings.push(`${lines} lines (below 300 target)`);
  else if (lines > 700) warnings.push(`${lines} lines (over 700, consider splitting)`);

  // 5. Tips bullets
  const tipsMatch = content.match(/^## Tips\n([\s\S]*?)(?=^## |\z)/m);
  if (tipsMatch) {
    const tipBullets = (tipsMatch[1].match(/^- /gm) || []).length;
    if (tipBullets < 3) warnings.push(`Tips has ${tipBullets} bullets (target 5-10)`);
  }

  // 6. Placeholder detection
  if (/\b(TODO|FIXME|YOUR_TOKEN|PLACEHOLDER)\b/.test(content))
    warnings.push('Contains placeholder text (TODO, FIXME, etc.)');

  // 7. Section count
  const sections = (content.match(/^## /gm) || []).length;
  if (sections < 3) errors.push(`Only ${sections} sections (min 3)`);

  return { valid: errors.length === 0, errors, warnings, stats: { lines, codeBlocks, sections } };
}
```

## Finalize: Write, Update Backlog, Post Embed, Notify

```javascript
function writeSkillFileAtomic(slug, content) {
  const targetDir  = path.join(SKILLS_DIR, slug);
  const targetPath = path.join(targetDir, 'SKILL.md');
  const tmpPath    = `/tmp/skill-forge-${slug}-${Date.now()}.md`;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
  return targetPath;
}

function cleanupPartialSkill(slug) {
  const targetDir = path.join(SKILLS_DIR, slug);
  try { if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true }); }
  catch (err) { console.warn(`[skill-forge] Cleanup failed for ${targetDir}: ${err.message}`); }
}

async function finalizeForge(channel, ideaId, slug, content, validation) {
  // Write atomically (overwrite if agent already wrote it)
  const targetPath = path.join(SKILLS_DIR, slug, 'SKILL.md');
  const tmpPath = `/tmp/skill-forge-${slug}-${Date.now()}.md`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);

  // Update backlog if from pipeline
  if (ideaId) {
    const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
    const idea = backlog.ideas.find(i => i.id === ideaId);
    if (idea) {
      idea.status = 'forged'; idea.skill_slug = slug; idea.forged_at = new Date().toISOString();
    }
    const tmp = `/tmp/backlog-forge-${Date.now()}.json`;
    fs.writeFileSync(tmp, JSON.stringify(backlog, null, 2));
    fs.renameSync(tmp, BACKLOG_PATH);
  }

  // Post success embed
  const hasWarnings = validation.warnings.length > 0;
  const fields = [
    { name: 'Slug', value: `\`${slug}\``, inline: true },
    { name: 'Install Path', value: `\`~/.agents/skills/${slug}/\``, inline: true },
    { name: 'Stats', value: `${validation.stats.lines} lines | ${validation.stats.codeBlocks} code blocks | ${validation.stats.sections} sections`, inline: false }
  ];
  if (hasWarnings) fields.push({ name: 'Warnings', value: validation.warnings.map(w => `- ${w}`).join('\n'), inline: false });

  await channel.send({ embeds: [{
    title: `Skill Forged${hasWarnings ? ' with Warnings' : ''} — ${ideaId || slug}`,
    fields, color: hasWarnings ? 0xffaa00 : 0x00ff00,
    footer: { text: 'openclaw-skill-forge' }, timestamp: new Date().toISOString()
  }] });

  // Notify #skill-registry
  const registryChannel = channel.client.channels.cache.find(c => c.name === 'skill-registry');
  if (registryChannel) {
    await registryChannel.send(ideaId ? `[SYSTEM] NEW_SKILL ${slug} ${ideaId}` : `[SYSTEM] NEW_SKILL ${slug}`);
  } else {
    console.warn('[skill-forge] #skill-registry not found — skipping notification');
  }

  console.log(`[skill-forge] Forged ${slug} at ${targetPath}`);
}
```

## Discord Embeds (Error and Warning)

```javascript
async function postEmbed(channel, type, label, messages) {
  const config = {
    error:   { title: `Forge Failed — ${label || 'direct'}`, desc: 'The SKILL.md could not be generated or validated.', color: 0xff0000, field: 'Errors' },
    warning: { title: `Forge Blocked — ${label}`, desc: 'The forge was blocked before any files were written.', color: 0xffaa00, field: 'Reason' }
  }[type];

  await channel.send({ embeds: [{
    title: config.title, description: config.desc,
    fields: [{ name: config.field, value: messages.map(m => `- ${m}`).join('\n'), inline: false }],
    color: config.color, footer: { text: 'openclaw-skill-forge' }, timestamp: new Date().toISOString()
  }] });
}
```

## Verification After Forge

```bash
# Verify file was written and check stats
ls -lh ~/.agents/skills/${SLUG}/SKILL.md
head -10 ~/.agents/skills/${SLUG}/SKILL.md
wc -l ~/.agents/skills/${SLUG}/SKILL.md
grep -c '^## ' ~/.agents/skills/${SLUG}/SKILL.md

# Verify backlog updated and OpenClaw sees the new skill
jq --arg id "$IDEA_ID" '.ideas[] | select(.id == $id) | {status, skill_slug, forged_at}' \
  ~/.agents/data/idea-backlog.json
openclaw skills list | grep "$SLUG"
```

## Tips

- The auto-refine step is the quality gate. Vague descriptions produce vague skills. The 20-character minimum catches the worst inputs.
- The `skill-writer` SKILL.md is embedded verbatim in the agent prompt. When skill-writer is updated, the forge immediately uses the new guidelines.
- Always use tmp-then-mv for atomic writes. A partial write corrupts the skill registry.
- The `[SYSTEM] NEW_SKILL {slug}` message must always be sent, even with validation warnings. skill-dependency-mapper needs to run its conflict check regardless.
- Set `maxBuffer: 10 * 1024 * 1024` (10 MB) on execAsync. Agent output can exceed Node's default 1 MB buffer.
- `#skill-forge` is the automated lane; `#skill-factory` is the human-confirmed lane. These are separate channels.
- The retry uses `strict = true` which appends explicit line-count and code-block requirements, catching most first-generation failures.
- `extractSkillMd` has four fallback strategies (skill-md fence, markdown fence, raw frontmatter, disk read) because the agent may use any output format.
- The `forged` status is a terminal state distinct from `built`. Query with `jq '.ideas[] | select(.status == "forged")'`.
- For complex skills requiring sensitive APIs, the generated SKILL.md documents those in its Prerequisites section. The forge never injects secrets.
