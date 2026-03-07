---
name: discord-skill-factory
description: Generate properly structured SKILL.md files from refined skill descriptions posted in Discord's #skill-factory channel. Use when converting confirmed prompts into installable skills, creating new skill directories under ~/.agents/skills/, piping refined specs into the skill-writer skill, handling duplicate or invalid skill slugs, or completing the final build step in the idea-to-skill pipeline. Communicates upstream with discord-prompt-refiner and downstream with skill-dependency-mapper via #skill-registry.
metadata: {"clawdbot":{"emoji":"🏭","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Discord Skill Factory

Listen on `#skill-factory` for refined skill description messages forwarded from `#prompt-refiner`. Pipe the message content into the `skill-writer` skill to generate a properly structured SKILL.md. Create a new subdirectory under `~/.agents/skills/` using a slugified skill name. Handle edge cases: vague input → ask for more detail, duplicate directory → confirm overwrite, invalid slug characters → auto-sanitize. Reply in `#skill-factory` with the skill name, install path, and generated `description:` field for verification. Update the idea status in `idea-backlog.json` to `built`.

## When to Use

- A confirmed, refined prompt arrives in `#skill-factory` from discord-prompt-refiner
- Converting a skill spec into a properly structured SKILL.md file
- Creating and organizing skill directories under `~/.agents/skills/`
- Handling naming conflicts or invalid slugs during skill creation
- Completing the final build step in the idea-to-skill pipeline
- Triggering the downstream skill-dependency-mapper via `#skill-registry`

## Prerequisites

### Shared Bot

Same Discord bot as the rest of the pipeline.

```bash
echo $DISCORD_BOT_TOKEN
```

### Channel Permissions

The bot needs `READ_MESSAGES` and `SEND_MESSAGES` in:
- `#skill-factory` (primary channel)
- `#skill-registry` (for notifying skill-dependency-mapper)

### Skills Directory

```bash
mkdir -p ~/.agents/skills
ls ~/.agents/skills/
```

### skill-writer Availability

The `skill-writer` skill must be installed and accessible.

```bash
ls ~/.agents/skills/skill-writer/SKILL.md || ls ~/.claude/skills/skill-writer/SKILL.md
```

## Step-by-Step Build Process

### Step 1: Listen for Build Requests

```javascript
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const SKILLS_DIR = path.join(process.env.HOME, '.agents', 'skills');
const BACKLOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const pendingBuilds = new Map();

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'skill-factory') return;

  // Accept system forwarded messages from prompt-refiner
  const systemMatch = message.content.match(
    /\[SYSTEM\] BUILD_SKILL (IDEA-\d{4})/
  );

  if (systemMatch) {
    const ideaId = systemMatch[1];
    await buildSkill(message, ideaId);
    return;
  }

  // Accept direct build requests from authorized users
  if (!message.author.bot && isAuthorizedUser(message.author.id)) {
    await buildSkillDirect(message);
  }
});
```

### Step 2: Extract the Refined Prompt

Parse the refined skill description from the message content.

```javascript
function extractRefinedPrompt(messageContent) {
  const cleaned = messageContent
    .replace(/\[SYSTEM\] BUILD_SKILL IDEA-\d{4}/g, '')
    .replace(/\*\*Build Request — IDEA-\d{4}\*\*/g, '')
    .trim();

  if (cleaned.length < 50) {
    return { valid: false, reason: 'Refined prompt is too short or empty.' };
  }

  return { valid: true, prompt: cleaned };
}
```

### Step 3: Derive the Skill Slug

Extract a slug from the description field. Sanitize for use as a directory name.

```javascript
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // Remove invalid chars
    .replace(/\s+/g, '-')            // Spaces to hyphens
    .replace(/-+/g, '-')             // Collapse multiple hyphens
    .replace(/^-|-$/g, '')           // Trim leading/trailing hyphens
    .substring(0, 40);               // Max 40 chars
}

function deriveSlug(refinedPrompt) {
  const descMatch = refinedPrompt.match(
    /\*\*description:\*\*\s*(.+?)(?:\n|$)/i
  );

  if (descMatch) {
    const words = descMatch[1]
      .replace(/[^a-zA-Z\s]/g, '')
      .split(/\s+/)
      .filter(w => !['the', 'a', 'an', 'on', 'in', 'for', 'and', 'to', 'of'].includes(w.toLowerCase()))
      .slice(0, 3);
    return slugify(words.join(' '));
  }

  const firstLine = refinedPrompt.split('\n')[0];
  return slugify(firstLine.substring(0, 40));
}
```

### Step 4: Check for Duplicate Directory

```javascript
async function checkDuplicate(channel, slug) {
  const targetDir = path.join(SKILLS_DIR, slug);

  if (fs.existsSync(targetDir)) {
    await channel.send(
      `Directory \`~/.agents/skills/${slug}/\` already exists.\n` +
      `Reply **overwrite** to replace it, or **rename <new-slug>** to use a different name.`
    );
    return { exists: true, path: targetDir };
  }

  return { exists: false, path: targetDir };
}
```

Handle the overwrite/rename response:

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'skill-factory') return;
  if (!isAuthorizedUser(message.author.id)) return;

  if (message.content.toLowerCase().startsWith('overwrite')) {
    const pending = getPendingBuild();
    if (pending) {
      await proceedWithBuild(message.channel, pending, true);
    }
    return;
  }

  const renameMatch = message.content.match(/^rename\s+([a-z0-9-]+)/i);
  if (renameMatch) {
    const pending = getPendingBuild();
    if (pending) {
      pending.slug = slugify(renameMatch[1]);
      await proceedWithBuild(message.channel, pending, false);
    }
  }
});
```

### Step 5: Validate Input Quality

Reject vague or incomplete inputs before piping to skill-writer.

```javascript
function validateRefinedPrompt(prompt) {
  const checks = [];

  if (!/description:/i.test(prompt)) {
    checks.push('Missing `description:` field');
  }
  if (!/when to use|trigger/i.test(prompt)) {
    checks.push('Missing "When to Use" / trigger phrases');
  }
  if (!/instruction|step|outline/i.test(prompt)) {
    checks.push('Missing instruction outline');
  }
  if (!/edge case|error|failure/i.test(prompt)) {
    checks.push('Missing edge cases section');
  }

  if (checks.length > 0) {
    return {
      valid: false,
      reason: `Input is missing required sections:\n${checks.map(c => `- ${c}`).join('\n')}\n\nPlease provide more detail or return to #prompt-refiner.`
    };
  }

  return { valid: true };
}
```

### Step 6: Pipe to OpenClaw Agent (with llm.complete() fallback)

Generate the SKILL.md content by invoking the OpenClaw agent CLI with full skill-writer context. Falls back to `llm.complete()` if `openclaw` is not available.

```javascript
// --- Availability check (run once at bot startup, cache result) ---
let _openClawAvailable = null;

function checkOpenClawAvailable() {
  if (_openClawAvailable !== null) return _openClawAvailable;
  try {
    execSync('which openclaw', { encoding: 'utf8', timeout: 5000 });
    _openClawAvailable = true;
  } catch {
    _openClawAvailable = false;
    console.warn('[skill-factory] openclaw not found — will use llm.complete() fallback');
  }
  return _openClawAvailable;
}

checkOpenClawAvailable();
```

```javascript
// --- OpenClaw agent runner (async to avoid blocking event loop) ---
async function runOpenClawAgent(agentMessage, timeoutMs = 330000) {
  const escaped = agentMessage.replace(/'/g, "'\\''");
  const cmd =
    `openclaw agent --message '${escaped}' ` +
    `--json --thinking medium --timeout 300`;

  let rawOutput;
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024
    });
    rawOutput = stdout;
  } catch (err) {
    if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM' || err.killed) {
      throw new Error('OpenClaw agent timed out after 330s');
    }
    const stderr = (err.stderr || '').trim().slice(0, 300);
    throw new Error(
      `openclaw agent exited with code ${err.code}: ${stderr || err.message}`
    );
  }

  // Parse JSON envelope
  let envelope;
  try {
    envelope = JSON.parse(rawOutput.trim());
  } catch {
    const jsonStart = rawOutput.indexOf('{');
    if (jsonStart === -1) {
      throw new Error(`openclaw agent returned non-JSON output: ${rawOutput.slice(0, 200)}`);
    }
    envelope = JSON.parse(rawOutput.slice(jsonStart));
  }

  if (envelope.success === false) {
    throw new Error(
      `OpenClaw agent reported failure: ${envelope.error || 'no error message'}`
    );
  }

  return envelope;
}
```

```javascript
// --- llm.complete() fallback (original logic) ---
async function generateSkillMdFallback(refinedPrompt, slug) {
  const skillWriterPrompt = `Using the skill-writer guidelines, generate a complete SKILL.md file for the following skill.

Skill slug: ${slug}

Refined specification:
${refinedPrompt}

Requirements:
- Valid YAML frontmatter with name, description, and metadata fields
- description field must be a single sentence starting with a verb
- Include "When to Use" section with 4-6 bullet points
- Include concrete code blocks in every content section
- Include a Tips section with 5+ actionable bullets
- Target 300-550 lines total
- Use the Workflow/Process Guide template structure

Return ONLY the complete SKILL.md file content, starting with the --- frontmatter delimiter.`;

  return await llm.complete(skillWriterPrompt);
}
```

```javascript
// --- Primary entry point: generates SKILL.md via OpenClaw agent ---
async function generateSkillMd(refinedPrompt, slug, channel) {
  const targetPath = path.join(SKILLS_DIR, slug, 'SKILL.md');
  const skillWriterPath = path.join(SKILLS_DIR, 'skill-writer', 'SKILL.md');

  // Route to fallback if openclaw is unavailable
  if (!checkOpenClawAvailable()) {
    console.warn('[skill-factory] Using llm.complete() fallback for', slug);
    return await generateSkillMdFallback(refinedPrompt, slug);
  }

  // Construct the agent message with skill-writer context
  const agentMessage =
    `Read the skill-writer guidelines from ${skillWriterPath}, ` +
    `then generate a complete SKILL.md file for the following skill specification. ` +
    `Write the file to ${targetPath}. ` +
    `Create the directory if it does not exist.\n\n` +
    `Skill slug: ${slug}\n\n` +
    `Refined specification:\n${refinedPrompt}\n\n` +
    `Requirements:\n` +
    `- Valid YAML frontmatter with name, description, and metadata fields\n` +
    `- metadata.clawdbot.emoji must be a single relevant emoji\n` +
    `- description field must be a single sentence starting with a verb\n` +
    `- Include "When to Use" section with 4-8 bullet points\n` +
    `- Every content section must have at least one code block\n` +
    `- Include a Tips section with 5-10 bullets\n` +
    `- Target 300-550 lines total, 15-40 code blocks\n` +
    `- Use the Workflow/Process Guide template structure\n` +
    `Confirm when the file has been written by reporting the line count.`;

  await channel.send(
    `Building \`${slug}\` via OpenClaw agent... This takes up to 5 minutes.`
  );

  const envelope = await runOpenClawAgent(agentMessage, 330000);

  // Agent should have written the file — verify and read it back
  if (fs.existsSync(targetPath)) {
    return fs.readFileSync(targetPath, 'utf8');
  }

  // File not on disk — try to extract from agent output
  const text = envelope.result || envelope.content || '';
  const fenceMatch = text.match(/```(?:skill-md|markdown|md)?\n(---[\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const rawMatch = text.match(/(---\n[\s\S]*?\n---[\s\S]+)/);
  if (rawMatch) return rawMatch[1].trim();

  throw new Error(
    `Agent reported success but file not found at ${targetPath} and ` +
    `output did not contain extractable SKILL.md content.`
  );
}
```

### OpenClaw Agent CLI Prerequisites

The `openclaw` binary must be installed and in PATH for agent-based generation. If unavailable, the skill falls back to `llm.complete()` automatically.

```bash
which openclaw || echo "openclaw not found — will use llm.complete() fallback"
openclaw --version
```

### Step 7: Write the SKILL.md File

```javascript
async function writeSkillFile(targetDir, skillMdContent, overwrite = false) {
  if (!overwrite && fs.existsSync(targetDir)) {
    throw new Error(`Directory ${targetDir} already exists`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(filePath, skillMdContent, 'utf8');
  return filePath;
}
```

```bash
# Equivalent shell commands
mkdir -p ~/.agents/skills/${SLUG}
cat > ~/.agents/skills/${SLUG}/SKILL.md << 'SKILL_EOF'
# ... generated content ...
SKILL_EOF
```

### Step 8: Validate the Generated SKILL.md

Run basic validation on the output before confirming.

```javascript
function validateSkillMd(content) {
  const errors = [];

  if (!content.startsWith('---')) {
    errors.push('Missing frontmatter delimiter');
  }

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    errors.push('Malformed frontmatter');
  } else {
    const fm = frontmatterMatch[1];
    if (!/^name:/m.test(fm)) errors.push('Missing `name` in frontmatter');
    if (!/^description:/m.test(fm)) errors.push('Missing `description` in frontmatter');
    if (!/^metadata:/m.test(fm)) errors.push('Missing `metadata` in frontmatter');
  }

  if (!/## When to Use/i.test(content)) errors.push('Missing "When to Use" section');
  if (!/## Tips/i.test(content)) errors.push('Missing "Tips" section');

  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  if (codeBlockCount < 8) errors.push(`Only ${codeBlockCount} code blocks (minimum 8)`);

  const lineCount = content.split('\n').length;
  if (lineCount < 150) errors.push(`Only ${lineCount} lines (target 300-550)`);

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      lines: content.split('\n').length,
      codeBlocks: (content.match(/```/g) || []).length / 2,
      sections: (content.match(/^## /gm) || []).length
    }
  };
}
```

### Step 9: Post Confirmation to #skill-factory

```javascript
async function postBuildConfirmation(channel, ideaId, slug, description, stats) {
  const embed = {
    title: `Skill Built — ${ideaId}`,
    fields: [
      { name: 'Skill Name', value: `\`${slug}\``, inline: true },
      { name: 'Install Path', value: `\`~/.agents/skills/${slug}/\``, inline: true },
      { name: 'description:', value: description, inline: false },
      { name: 'Stats', value: `${stats.lines} lines | ${stats.codeBlocks} code blocks | ${stats.sections} sections`, inline: false }
    ],
    color: 0x00ff00,
    timestamp: new Date().toISOString()
  };

  await channel.send({ embeds: [embed] });
}
```

### Step 10: Update Backlog and Notify Downstream

```javascript
function markIdeaBuilt(ideaId, slug) {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  const idea = backlog.ideas.find(i => i.id === ideaId);

  if (idea) {
    idea.status = 'built';
    idea.skill_slug = slug;
    idea.built_at = new Date().toISOString();
  }

  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));
}

async function notifyDependencyMapper(client, slug, ideaId) {
  const registryChannel = client.channels.cache.find(
    c => c.name === 'skill-registry'
  );
  if (registryChannel) {
    await registryChannel.send(`[SYSTEM] NEW_SKILL ${slug} ${ideaId}`);
  }
}
```

```bash
# Update backlog status to built
jq --arg id "$IDEA_ID" \
   --arg slug "$SLUG" \
   --arg built_at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
   '(.ideas[] | select(.id == $id)) |= . + {
     status: "built",
     skill_slug: $slug,
     built_at: $built_at
   }' ~/.agents/data/idea-backlog.json > /tmp/backlog-tmp.json \
   && mv /tmp/backlog-tmp.json ~/.agents/data/idea-backlog.json
```

## Edge Case Handling

### Vague Input

```javascript
const validation = validateRefinedPrompt(refinedPrompt);
if (!validation.valid) {
  await channel.send(
    `**Cannot build skill — input is incomplete.**\n${validation.reason}\n\n` +
    `Send the idea back to #prompt-refiner for more refinement.`
  );
  return;
}
```

### Invalid Slug Characters

Auto-sanitize and notify.

```javascript
const rawSlug = deriveSlug(refinedPrompt);
const cleanSlug = slugify(rawSlug);

if (rawSlug !== cleanSlug) {
  await channel.send(`Slug sanitized: \`${rawSlug}\` → \`${cleanSlug}\``);
}
```

### Generation Failure

If the OpenClaw agent produces invalid output, retry via `llm.complete()` fallback. If both fail, report errors.

```javascript
const agentUsed = checkOpenClawAvailable();
let skillMd;

try {
  // generateSkillMd routes to OpenClaw agent or llm.complete() fallback.
  // When using the agent, it writes the file and returns content.
  // When using the fallback, it returns content only (writeSkillFile still needed).
  skillMd = await generateSkillMd(refinedPrompt, slug, channel);
} catch (err) {
  await channel.send(
    `Generation attempt 1 failed: ${err.message.slice(0, 300)}\nRetrying via fallback...`
  );
  try {
    skillMd = await generateSkillMdFallback(refinedPrompt, slug);
  } catch (retryErr) {
    await channel.send(
      `Generation failed after retry: ${retryErr.message.slice(0, 300)}\n` +
      `Manual intervention required.`
    );
    return;
  }
}

let validation = validateSkillMd(skillMd);

if (!validation.valid) {
  await channel.send(
    `Generated file has quality issues: ${validation.errors.join(', ')}. Retrying via fallback...`
  );
  try {
    skillMd = await generateSkillMdFallback(refinedPrompt, slug);
    validation = validateSkillMd(skillMd);
  } catch (retryErr) {
    await channel.send(
      `Retry failed: ${retryErr.message.slice(0, 300)}\nManual intervention required.`
    );
    return;
  }

  if (!validation.valid) {
    await channel.send(
      `Generation failed after retry. Errors:\n` +
      validation.errors.map(e => `- ${e}`).join('\n') +
      `\nManual intervention required.`
    );
    return;
  }
}

// Write file only if agent did NOT already write it.
// Agent path: file already exists on disk. Fallback path: need to write.
const targetDir = path.join(SKILLS_DIR, slug);
const fileAlreadyWritten = agentUsed && fs.existsSync(path.join(targetDir, 'SKILL.md'));

if (!fileAlreadyWritten) {
  try {
    await writeSkillFile(targetDir, skillMd, overwrite);
  } catch (err) {
    await channel.send(`Failed to write skill file: ${err.message}`);
    return;
  }
}
```

## Tips

- Always validate the SKILL.md before writing to disk. A malformed file is worse than no file — it pollutes the skill registry.
- The slug derivation strips common filler words (the, a, an, for, and). Focus on nouns and verbs that describe the skill's purpose.
- Cap the slug at 40 characters. Longer slugs are unwieldy in directory listings and registry searches.
- The overwrite confirmation is critical. Never silently overwrite an existing skill — it may have been manually edited since generation.
- Post the generated `description:` field in the confirmation message. This is what the registry indexes, so the user should review it before the skill goes live.
- Retry generation at most once. If two attempts produce invalid SKILL.md, the refined prompt itself is the problem — send it back to #prompt-refiner.
- The `built_at` timestamp in the backlog enables the weekly-skill-digest to report on recently built skills.
- Notify skill-dependency-mapper via `[SYSTEM] NEW_SKILL` in `#skill-registry` after every build. It needs to scan for conflicts before the skill is used.
