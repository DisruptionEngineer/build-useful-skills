---
name: discord-prompt-refiner
description: Expand raw ideas into complete, well-structured skill descriptions via iterative Discord-based refinement with template reuse. Use when turning vague ideas into actionable skill specs, refining forwarded ideas from idea-scorer in #prompt-refiner, running confirmation loops with users via "confirm" or thumbs-up reactions, pulling from the reusable prompt template library at prompt-templates.json, or preparing confirmed prompts for the skill-factory pipeline. Communicates upstream with idea-scorer and downstream with discord-skill-factory.
metadata: {"clawdbot":{"emoji":"✏️","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Discord Prompt Refiner

Listen on `#prompt-refiner` for raw or forwarded ideas. Expand each into a complete, well-structured skill description including: a one-sentence semantic `description:` field, 3–5 "When to Use" trigger phrases, a step-by-step instruction outline, and relevant edge cases. Run an iterative confirmation loop with the user. Pull from and contribute to `~/.agents/data/prompt-templates.json`. Once confirmed, forward to `#skill-factory` and update the idea's status in `idea-backlog.json` to `ready`.

## When to Use

- An idea arrives in `#prompt-refiner` from idea-scorer (standard or fast-track)
- A user manually posts a rough idea directly into `#prompt-refiner`
- Iterating on a skill description that needs more detail or corrections
- Building or reusing prompt templates for common skill patterns
- Preparing a confirmed, complete skill spec for discord-skill-factory
- Saving a successful refined prompt back to the template library for future reuse

## Prerequisites

### Shared Bot

Same Discord bot as the rest of the pipeline.

```bash
echo $DISCORD_BOT_TOKEN
```

### Channel Permissions

The bot needs `READ_MESSAGES` and `SEND_MESSAGES` in:
- `#prompt-refiner` (primary channel)
- `#skill-factory` (for forwarding confirmed prompts)

The bot also needs `GuildMessageReactions` intent for thumbs-up confirmation.

### Prompt Template Library

Initialize the template library if it doesn't exist.

```bash
if [ ! -f ~/.agents/data/prompt-templates.json ]; then
  echo '{"templates": []}' > ~/.agents/data/prompt-templates.json
fi
```

### Template Schema

```json
{
  "templates": [
    {
      "id": "TPL-0001",
      "pattern": "discord-listener",
      "description": "Listen on a Discord channel and react to messages matching a pattern",
      "template": {
        "description_field": "Listen on Discord's #{channel} for {event_type} and {action}.",
        "trigger_phrases": [
          "A new {event_type} is posted in #{channel}",
          "Processing {event_type} messages from authorized users",
          "Reacting to #{channel} activity with {action}"
        ],
        "instruction_outline": [
          "Listen for messages in the target channel",
          "Validate sender against authorized users list",
          "Parse message content for {event_type}",
          "Execute {action}",
          "Confirm completion in channel"
        ],
        "edge_cases": [
          "Unauthorized user posts in channel",
          "Message format doesn't match expected pattern",
          "Target service is unreachable"
        ]
      },
      "times_used": 5,
      "last_used": "2026-02-20T10:00:00.000Z"
    }
  ]
}
```

## Refined Prompt Output Format

Every refined prompt must contain these four sections:

```markdown
## Refined Skill Description

**description:** Listen on Discord's #deploy-alerts for deployment
webhook events and post formatted summaries to #team-updates with
status, duration, and commit info.

### When to Use (Trigger Phrases)
- A deployment webhook fires and needs to be captured
- The team wants real-time deploy notifications in Discord
- Summarizing deploy metadata (status, duration, commits) for a channel

### Instruction Outline
1. Listen for messages in #deploy-alerts matching webhook payload format
2. Validate the message source against allowed webhook IDs
3. Parse deployment metadata: status, environment, duration, commit SHA
4. Format a Discord embed with color-coded status
5. Post the formatted summary to #team-updates
6. If deploy failed, additionally ping the @oncall role

### Edge Cases
- Webhook payload is malformed or missing required fields
- #team-updates channel is unreachable or bot lacks permissions
- Duplicate webhook deliveries (idempotency check on commit SHA + timestamp)
- Deploy status is "in_progress" — wait for final status before posting
```

## Step-by-Step Refinement

### Step 1: Receive and Parse Incoming Ideas

```javascript
const fs = require('fs');
const path = require('path');
const BACKLOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');
const TEMPLATES_PATH = path.join(process.env.HOME, '.agents', 'data', 'prompt-templates.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const pendingConfirmations = new Map();

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'prompt-refiner') return;
  if (message.author.bot && !message.content.includes('[SYSTEM]')) return;
  if (!message.author.bot && !isAuthorizedUser(message.author.id)) return;

  // Parse system forwarded messages from idea-scorer
  const systemMatch = message.content.match(
    /\[SYSTEM\] REFINE_IDEA (IDEA-\d{4})(?: FAST_TRACK)?/
  );

  if (systemMatch) {
    const ideaId = systemMatch[1];
    const isFastTrack = message.content.includes('FAST_TRACK');
    await refineFromBacklog(message.channel, ideaId, isFastTrack);
    return;
  }

  // Direct user submission
  await refineDirectInput(message);
});
```

### Step 2: Check Template Library for Matching Patterns

Before generating from scratch, search the template library for similar patterns.

```javascript
function findMatchingTemplate(rawText) {
  const templates = loadJSON(TEMPLATES_PATH) || { templates: [] };

  const keywords = rawText.toLowerCase().split(/\s+/);
  const patternKeywords = {
    'discord-listener': ['listen', 'channel', 'discord', 'message', 'watch'],
    'cron-job': ['schedule', 'cron', 'weekly', 'daily', 'periodic', 'every'],
    'file-watcher': ['watch', 'file', 'directory', 'change', 'modify'],
    'api-webhook': ['webhook', 'api', 'endpoint', 'http', 'post'],
    'data-pipeline': ['transform', 'pipeline', 'process', 'convert', 'parse']
  };

  let bestMatch = null;
  let bestScore = 0;

  for (const tpl of templates.templates) {
    const pKeywords = patternKeywords[tpl.pattern] || [];
    const overlap = keywords.filter(k => pKeywords.includes(k)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = tpl;
    }
  }

  return bestScore >= 2 ? bestMatch : null;
}
```

### Step 3: Generate the Refined Prompt

Use the LLM to expand the raw idea into the four required sections. If a template matches, provide it as a scaffold.

```javascript
async function generateRefinedPrompt(rawText, template = null) {
  let prompt = `Expand this raw idea into a complete skill description.

Raw idea: "${rawText}"

Generate exactly four sections:
1. **description:** field — one sentence, starts with a verb, includes specific triggers
2. **When to Use** — 3-5 trigger phrases starting with gerunds or "A/An/The..."
3. **Instruction Outline** — 4-8 numbered steps, imperative voice
4. **Edge Cases** — 3-6 specific failure modes or boundary conditions`;

  if (template) {
    prompt += `\n\nUse this template as a scaffold (adapt, don't copy verbatim):
${JSON.stringify(template.template, null, 2)}`;
  }

  prompt += `\n\nReturn the result in the exact markdown format shown. Do not add extra sections.`;

  return await llm.complete(prompt);
}
```

### Step 4: Post for Confirmation

```javascript
async function postForConfirmation(channel, ideaId, refinedPrompt, isFastTrack) {
  const header = isFastTrack
    ? `**FAST-TRACK Refinement — ${ideaId}**`
    : `**Refined Prompt — ${ideaId}**`;

  await channel.send(
    `${header}\n\n${refinedPrompt}\n\n` +
    `---\n` +
    `Reply **confirm** or react with a thumbs-up to approve.\n` +
    `Reply with corrections for another refinement round.`
  );

  pendingConfirmations.set(ideaId, {
    refinedPrompt,
    channel: channel.id,
    rounds: 1,
    isFastTrack
  });
}
```

### Step 5: Handle Confirmation or Correction

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'prompt-refiner') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const isConfirm = message.content.toLowerCase().trim() === 'confirm';

  if (isConfirm) {
    const pending = getLatestPending();
    if (!pending) {
      await message.reply('No pending refinement to confirm.');
      return;
    }
    await confirmAndForward(message.channel, pending.ideaId, pending);
    return;
  }

  // Otherwise treat as a correction — refine again
  const pending = getLatestPending();
  if (pending) {
    await refineWithCorrections(message.channel, pending, message.content);
  }
});
```

### Step 6: Handle Reaction-Based Confirmation

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.emoji.name !== '👍') return;
  if (user.bot) return;
  if (reaction.message.channel.name !== 'prompt-refiner') return;
  if (!isAuthorizedUser(user.id)) return;

  const pending = findPendingByMessageChannel(reaction.message.channel.id);
  if (pending) {
    await confirmAndForward(reaction.message.channel, pending.ideaId, pending);
  }
});
```

### Step 7: Forward Confirmed Prompt to #skill-factory

```javascript
async function confirmAndForward(channel, ideaId, pending) {
  const factoryChannel = channel.guild.channels.cache.find(
    c => c.name === 'skill-factory'
  );

  await factoryChannel.send(
    `**Build Request — ${ideaId}**\n\n` +
    `${pending.refinedPrompt}\n\n` +
    `[SYSTEM] BUILD_SKILL ${ideaId}`
  );

  // Update backlog status to "ready"
  updateIdeaStatus(ideaId, 'ready', pending.refinedPrompt);

  // Save successful template to library
  await saveToTemplateLibrary(pending.refinedPrompt);

  await channel.send(
    `**${ideaId}** confirmed and forwarded to #skill-factory.\n` +
    `Status updated to \`ready\` in backlog.`
  );

  pendingConfirmations.delete(ideaId);
}
```

## Iterative Correction Loop

When a user replies with corrections, re-run the LLM with the original raw text, current refined version, and the correction feedback.

```javascript
async function refineWithCorrections(channel, pending, corrections) {
  pending.rounds += 1;

  if (pending.rounds > 5) {
    await channel.send(
      `Reached 5 refinement rounds for **${pending.ideaId}**. ` +
      `Please provide a more complete description or confirm as-is.`
    );
    return;
  }

  const prompt = `Revise this skill description based on user feedback.

Current version:
${pending.refinedPrompt}

User feedback:
"${corrections}"

Apply the feedback precisely. Keep the same four-section format.
Return the full revised description.`;

  const revised = await llm.complete(prompt);
  pending.refinedPrompt = revised;

  await channel.send(
    `**Revision ${pending.rounds} — ${pending.ideaId}**\n\n` +
    `${revised}\n\n---\n` +
    `Reply **confirm** or react with a thumbs-up to approve.\n` +
    `Reply with more corrections for another round.`
  );
}
```

## Template Library Management

### Save a Successful Prompt as a Template

```javascript
async function saveToTemplateLibrary(refinedPrompt) {
  const library = loadJSON(TEMPLATES_PATH) || { templates: [] };
  const pattern = detectPattern(refinedPrompt);

  const existing = library.templates.find(t => t.pattern === pattern);
  if (existing) {
    existing.times_used += 1;
    existing.last_used = new Date().toISOString();
  } else {
    const newId = `TPL-${String(library.templates.length + 1).padStart(4, '0')}`;
    library.templates.push({
      id: newId,
      pattern: pattern,
      description: extractDescription(refinedPrompt),
      template: extractTemplateSections(refinedPrompt),
      times_used: 1,
      last_used: new Date().toISOString()
    });
  }

  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(library, null, 2));
}
```

### Query the Template Library

```bash
# List all templates sorted by usage
jq '.templates | sort_by(-.times_used) | .[] | {id, pattern, times_used}' \
  ~/.agents/data/prompt-templates.json

# Find templates matching a keyword
jq '.templates[] | select(.description | test("discord"; "i")) | {id, pattern, description}' \
  ~/.agents/data/prompt-templates.json
```

## Updating the Backlog

```javascript
function updateIdeaStatus(ideaId, status, refinedPrompt = null) {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  const idea = backlog.ideas.find(i => i.id === ideaId);
  if (!idea) return;

  idea.status = status;
  if (refinedPrompt) {
    idea.refined_prompt = refinedPrompt;
  }

  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));
}
```

```bash
# Update status to ready with refined prompt stored
jq --arg id "$IDEA_ID" \
   --arg prompt "$REFINED_PROMPT" \
   '(.ideas[] | select(.id == $id)) |= . + {
     status: "ready",
     refined_prompt: $prompt
   }' ~/.agents/data/idea-backlog.json > /tmp/backlog-tmp.json \
   && mv /tmp/backlog-tmp.json ~/.agents/data/idea-backlog.json
```

## Error Handling

```javascript
async function refineFromBacklog(channel, ideaId, isFastTrack) {
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    const idea = backlog.ideas.find(i => i.id === ideaId);

    if (!idea) {
      await channel.send(`Idea **${ideaId}** not found in backlog.`);
      return;
    }

    const template = findMatchingTemplate(idea.raw_text);
    const templateNote = template
      ? `Using template **${template.id}** (${template.pattern}) as scaffold.`
      : 'No matching template found — generating from scratch.';

    await channel.send(templateNote);

    const refined = await generateRefinedPrompt(idea.raw_text, template);
    await postForConfirmation(channel, ideaId, refined, isFastTrack);
  } catch (err) {
    console.error(`[prompt-refiner] Error refining ${ideaId}:`, err);
    await channel.send(`Failed to refine **${ideaId}**: ${err.message}`);
  }
}
```

## Tips

- Cap refinement rounds at 5. If a prompt needs more than 5 rounds, the original idea probably needs to be broken into smaller pieces.
- The template library is the compounding advantage of this system. Every confirmed prompt makes future refinements faster and more consistent.
- Always show the user which template was used (if any). Transparency about the scaffold prevents confusion when the output looks familiar.
- Fast-tracked ideas still go through refinement — they just skip the queue. The fast-track flag is a signal to prioritize, not to skip steps.
- Store the `refined_prompt` field in `idea-backlog.json` so discord-skill-factory has a clean input without re-parsing Discord messages.
- Reaction-based confirmation requires the `GuildMessageReactions` intent. Add it to the bot's intent list or the reaction handler will silently fail.
- The `detectPattern` function should categorize by interaction type (listener, cron, watcher, webhook, pipeline) not by domain. Patterns reuse better across domains.
- If the LLM generates a refined prompt missing any of the four required sections, reject it and retry rather than forwarding an incomplete spec to skill-factory.
- The `[SYSTEM] BUILD_SKILL` message tag is what discord-skill-factory listens for. Do not change this format without updating the downstream skill.
