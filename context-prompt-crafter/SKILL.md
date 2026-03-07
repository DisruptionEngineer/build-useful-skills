---
name: context-prompt-crafter
description: Iteratively build context-rich implementation prompts for Claude Code via Discord conversation. Use when crafting a feature request into a complete implementation prompt, working through missing project context via guided questions, turning vague ideas into fully-scoped Claude Code instructions with acceptance criteria and test plans, or saving proven prompt structures as reusable templates. Operates in #context-crafter with reply-based iteration.
metadata: {"clawdbot":{"emoji":"🎯","requires":{"anyBins":["node","jq"]},"os":["linux","darwin"]}}
---

# Context Prompt Crafter

Listen on `#context-crafter` for initial feature ideas or implementation requests. Analyze the prompt for missing context across eight dimensions, then guide the user through targeted question rounds via Discord replies. Each round fills gaps until the prompt is complete enough for Claude Code to fully document, implement, test, and deploy the feature. Store confirmed prompts in `~/.agents/data/context-prompts.json` and optionally forward to `#skill-factory` or export as a markdown file.

## When to Use

- A user posts a feature idea or implementation request in `#context-crafter`
- Turning a vague concept into a structured Claude Code prompt with full context
- Iterating on missing project context, acceptance criteria, or test plans via Discord replies
- Reviewing and scoring a prompt's completeness before handing it to Claude Code
- Saving a finalized prompt as a reusable template for similar features

## Prerequisites

Same OpenClaw Discord bot as the rest of the pipeline. The bot needs `READ_MESSAGES`, `SEND_MESSAGES`, `ADD_REACTIONS`, and `GuildMessageReactions` intent in `#context-crafter`.

```bash
# Verify bot token and initialize archive
echo $DISCORD_BOT_TOKEN
if [ ! -f ~/.agents/data/context-prompts.json ]; then
  echo '{"prompts": [], "templates": []}' > ~/.agents/data/context-prompts.json
fi
```

### Prompt Archive Schema

```json
{
  "prompts": [
    {
      "id": "CP-0001",
      "status": "confirmed",
      "created": "2026-02-28T10:00:00.000Z",
      "confirmed": "2026-02-28T10:30:00.000Z",
      "author": "discord-user-id",
      "raw_input": "I want to add dark mode to my app",
      "rounds": 3,
      "dimensions": {
        "project": { "score": 5, "filled": true },
        "scope": { "score": 5, "filled": true },
        "criteria": { "score": 4, "filled": true },
        "constraints": { "score": 3, "filled": true },
        "existing_code": { "score": 4, "filled": true },
        "testing": { "score": 5, "filled": true },
        "deployment": { "score": 3, "filled": true },
        "edge_cases": { "score": 4, "filled": true }
      },
      "completeness_score": 85,
      "final_prompt": "## Project Context\n..."
    }
  ],
  "templates": [
    { "id": "CT-0001", "source_prompt": "CP-0001", "created": "...", "times_reused": 0 }
  ]
}
```

## The Eight Context Dimensions

Every implementation prompt needs coverage across these dimensions. Score each 1-5; ask targeted questions for any scoring below 3.

| Dimension | What It Captures | Key Questions |
|---|---|---|
| **Project** | Repo, language, framework, architecture | What repo? What stack? Monorepo or single? |
| **Scope** | Specific feature requirements | What exactly should be built? What's in/out of scope? |
| **Criteria** | Acceptance criteria, definition of done | How do we know it's done? What does success look like? |
| **Constraints** | Tech constraints, dependencies, APIs | Any libraries required? API contracts? Performance targets? |
| **Existing Code** | Files to modify, patterns to match | Which files are involved? What patterns should be followed? |
| **Testing** | Unit, integration, E2E test strategy | What test framework? What coverage expectations? |
| **Deployment** | CI/CD, environments, rollout plan | How does it deploy? Any feature flags needed? |
| **Edge Cases** | Error handling, boundary conditions | What can go wrong? What edge cases matter? |

## Final Prompt Output Format

The confirmed prompt follows this structure, ready to paste into Claude Code:

```markdown
## Project Context
- **Repository:** {repo_url_or_name}
- **Stack:** {language}, {framework}, {key_dependencies}
- **Architecture:** {monorepo|single|microservices}
- **Key Files:** {entry_points, config_files}

## Feature: {feature_title}
### What to Build
{2-4 sentences}
### Requirements
1. {Specific requirement with measurable outcome}
### Out of Scope
- {Explicitly excluded items}

## Acceptance Criteria
- [ ] {Testable criterion}

## Technical Constraints
- {Library/API/pattern constraints}

## Existing Code Context
- **Files to modify:** {paths}
- **Patterns to follow:** {conventions}

## Testing Plan
- **Unit / Integration / E2E:** {framework, coverage, critical flows}

## Deployment
- **Process:** {CI/CD, environments, feature flags, rollback}

## Edge Cases & Error Handling
- {Edge case and expected behavior}
```

## Step-by-Step Implementation

### Step 1: Initialization and Message Listener

```javascript
const fs = require('fs');
const path = require('path');
const ARCHIVE_PATH = path.join(process.env.HOME, '.agents', 'data', 'context-prompts.json');
const activeSessions = new Map();

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'context-crafter') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const parentSession = findActiveSession(message);
  if (parentSession) {
    await handleReply(message, parentSession);
    return;
  }
  await startNewSession(message);
});

function findActiveSession(message) {
  if (message.reference?.messageId) {
    for (const [id, session] of activeSessions) {
      if (session.messageIds.includes(message.reference.messageId)) return session;
    }
  }
  for (const [id, session] of activeSessions) {
    if (session.author === message.author.id) return session;
  }
  return null;
}
```

### Step 2: Analyze Context Gaps

Score the initial prompt across all eight dimensions using keyword detection. Each dimension has a set of regex patterns with weights; matches accumulate into a 1-5 score.

```javascript
function analyzeContextGaps(rawText) {
  // Signal patterns per dimension: { pattern: regex, weight: 1-2 }
  const signalSets = {
    project: [
      { pattern: /\b(repo|repository|github|gitlab)\b/i, weight: 2 },
      { pattern: /\b(react|vue|next|express|django|flask|rails|spring)\b/i, weight: 2 },
      { pattern: /\b(typescript|javascript|python|go|rust|java)\b/i, weight: 1 },
      { pattern: /\b(monorepo|microservice|single.?app)\b/i, weight: 1 }
    ],
    scope: [
      { pattern: /\b(add|create|build|implement|support)\b/i, weight: 1 },
      { pattern: /\b(should|must|needs? to|required)\b/i, weight: 1 },
      { pattern: /\b(feature|functionality|capability|endpoint)\b/i, weight: 1 },
      { pattern: /\b(not|exclude|out of scope|skip|ignore)\b/i, weight: 2 }
    ],
    criteria: [
      { pattern: /\b(done when|success|acceptance|criteria|verify)\b/i, weight: 2 },
      { pattern: /\b(expected|behavior|output|result)\b/i, weight: 1 }
    ],
    constraints: [
      { pattern: /\b(must use|requires?|depends? on|compatible)\b/i, weight: 2 },
      { pattern: /\b(api|endpoint|sdk|library|package)\b/i, weight: 1 },
      { pattern: /\b(performance|latency|throughput|limit)\b/i, weight: 1 }
    ],
    existing_code: [
      { pattern: /\b(file|module|component|class|function)\b/i, weight: 1 },
      { pattern: /\b(modify|update|change|refactor|extend)\b/i, weight: 1 },
      { pattern: /\b(src\/|lib\/|app\/|pages\/|components\/)\b/i, weight: 2 }
    ],
    testing: [
      { pattern: /\b(test|spec|jest|pytest|mocha|vitest)\b/i, weight: 2 },
      { pattern: /\b(coverage|unit|integration|e2e|cypress)\b/i, weight: 2 }
    ],
    deployment: [
      { pattern: /\b(deploy|ci|cd|pipeline|staging|production)\b/i, weight: 2 },
      { pattern: /\b(docker|kubernetes|vercel|netlify|aws)\b/i, weight: 2 },
      { pattern: /\b(feature.?flag|rollback|migration)\b/i, weight: 1 }
    ],
    edge_cases: [
      { pattern: /\b(edge.?case|error|fail|invalid|empty|null)\b/i, weight: 2 },
      { pattern: /\b(timeout|retry|fallback|graceful)\b/i, weight: 1 },
      { pattern: /\b(what if|when|unless|boundary)\b/i, weight: 1 }
    ]
  };

  function scoreDimension(signals) {
    let score = 1;
    const found = [];
    for (const s of signals) {
      if (s.pattern.test(rawText)) { score += s.weight; found.push(s.pattern.source); }
    }
    return { score: Math.min(score, 5), filled: Math.min(score, 5) >= 3, signals: found };
  }

  const dimensions = {};
  for (const [key, signals] of Object.entries(signalSets)) {
    dimensions[key] = scoreDimension(signals);
  }
  return dimensions;
}
```

### Step 3: Start a New Session

```javascript
async function startNewSession(message) {
  try {
    if (message.content.trim().length < 10) {
      await message.reply('Your prompt is very short. Give me at least a sentence describing what you want to build.');
      return;
    }

    const archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
    const sessionId = `CP-${String(archive.prompts.length + 1).padStart(4, '0')}`;
    const dimensions = analyzeContextGaps(message.content);
    const completeness = calculateCompleteness(dimensions);
    const matchingTemplate = findMatchingTemplate(message.content);

    if (matchingTemplate) {
      await message.reply(`Found a similar template **${matchingTemplate.id}** — using it as a starting scaffold.`);
    }

    const session = {
      id: sessionId, author: message.author.id, raw_input: message.content,
      dimensions, completeness, rounds: 0,
      context: { project: '', scope: message.content, criteria: '', constraints: '',
                 existing_code: '', testing: '', deployment: '', edge_cases: '' },
      messageIds: [message.id], template: matchingTemplate || null
    };

    activeSessions.set(sessionId, session);
    const scorecard = formatScorecard(session);
    const questions = generateQuestions(dimensions);

    await message.reply(
      `**Context Analysis — ${sessionId}**\n\n${scorecard}\n\n---\n${questions}\n\n` +
      `Reply with answers to fill in the gaps. I'll ask follow-ups until we hit 80%+ completeness.`
    );
    session.rounds = 1;
  } catch (err) {
    console.error(`[context-crafter] Error starting session:`, err);
    await message.reply(`Failed to start session: ${err.message}`);
  }
}

function findMatchingTemplate(rawText) {
  try {
    const archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
    const keywords = rawText.toLowerCase().split(/\s+/);
    for (const tpl of archive.templates) {
      const tplWords = tpl.final_prompt.toLowerCase().split(/\s+/);
      if (keywords.filter(k => tplWords.includes(k)).length >= 5) return tpl;
    }
  } catch (e) {}
  return null;
}
```

### Step 4: Scorecard Display

```javascript
function calculateCompleteness(dimensions) {
  const scores = Object.values(dimensions).map(d => d.score);
  return Math.round((scores.reduce((a, b) => a + b, 0) / (scores.length * 5)) * 100);
}

function formatScorecard(session) {
  const labels = {
    project: 'Project', scope: 'Scope', criteria: 'Criteria', constraints: 'Constraints',
    existing_code: 'Existing Code', testing: 'Testing', deployment: 'Deployment', edge_cases: 'Edge Cases'
  };
  const filled = Math.round(session.completeness / 10);
  let card = `**Completeness: ${session.completeness}%** [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]\n\n`;
  for (const [key, label] of Object.entries(labels)) {
    const dim = session.dimensions[key];
    const dots = '●'.repeat(dim.score) + '○'.repeat(5 - dim.score);
    card += `${label}: ${dots} (${dim.score}/5)${dim.score < 3 ? ' ← needs input' : ''}\n`;
  }
  return card;
}
```

### Step 5: Generate Targeted Questions

Ask 2-3 questions per round, prioritizing the lowest-scoring dimensions.

```javascript
function generateQuestions(dimensions) {
  const questionBank = {
    project: ["What repo, language, and framework?", "Monorepo or single project? Architecture style?"],
    scope: ["Describe the feature in 2-3 sentences. What can a user do when done?", "What's explicitly OUT of scope?"],
    criteria: ["How do we know it's done? List 3-4 things that must be true.", "Measurable targets (response time, uptime)?"],
    constraints: ["Specific libraries, APIs, or services to integrate with?", "Performance limits or security constraints?"],
    existing_code: ["Which files or directories need changes?", "Similar feature to follow as a pattern? Coding conventions?"],
    testing: ["What test framework and expected coverage?", "Unit, integration, E2E, or all three?"],
    deployment: ["How does it deploy? CI/CD pipeline configured?", "Feature flags needed? Migration steps?"],
    edge_cases: ["What happens with invalid or empty input?", "What error states should the user see?"]
  };

  // Take the 2-3 weakest dimensions below threshold
  const weak = Object.entries(dimensions)
    .filter(([_, d]) => d.score < 3)
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 3);

  if (weak.length === 0) {
    const polish = Object.entries(dimensions)
      .filter(([_, d]) => d.score < 5)
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 2);
    if (polish.length === 0) return 'All dimensions look solid. Reply **confirm** to finalize.';
    return polish.map(([k]) => `**${k}:** ${questionBank[k][Math.floor(Math.random() * questionBank[k].length)]}`).join('\n\n');
  }
  return weak.map(([k]) => `**${k}:** ${questionBank[k][0]}`).join('\n\n');
}
```

### Step 6: Handle Replies and Integrate Context

When the user replies, use the LLM to classify which dimensions are addressed, update scores, then either ask more questions or offer confirmation.

```javascript
async function handleReply(message, session) {
  const lower = message.content.toLowerCase().trim();

  if (lower === 'confirm' || lower === 'done' || lower === 'looks good') {
    await confirmAndFinalize(message, session);
    return;
  }
  if (lower === 'start over' || lower === 'reset') {
    activeSessions.delete(session.id);
    await message.reply(`Session **${session.id}** reset. Post a new prompt to start fresh.`);
    return;
  }

  session.rounds += 1;
  if (session.rounds > 8) {
    await message.reply(
      `Reached 8 rounds for **${session.id}**. Reply **confirm** to finalize or **reset** to start over.`
    );
    return;
  }

  // LLM classifies which dimensions the reply addresses
  const classificationPrompt = `Given this user reply in a prompt-crafting session, identify which context dimensions it addresses and extract the relevant information.

User's reply: "${message.content}"

Dimensions: project, scope, criteria, constraints, existing_code, testing, deployment, edge_cases

Return JSON: { "addressed": { "dimension_name": { "score_delta": 1-3, "extracted": "summary" } } }
Only include dimensions the reply actually addresses.`;

  const parsed = JSON.parse(await llm.complete(classificationPrompt));

  for (const [dim, info] of Object.entries(parsed.addressed || {})) {
    if (session.dimensions[dim]) {
      session.dimensions[dim].score = Math.min(session.dimensions[dim].score + info.score_delta, 5);
      session.dimensions[dim].filled = session.dimensions[dim].score >= 3;
    }
    if (session.context[dim] !== undefined) {
      session.context[dim] += (session.context[dim] ? '\n' : '') + info.extracted;
    }
  }

  session.completeness = calculateCompleteness(session.dimensions);
  session.messageIds.push(message.id);

  if (session.completeness >= 80) {
    const draft = await generateFinalPrompt(session);
    session.draftPrompt = draft;
    await message.reply(
      `**${session.id} — Draft Ready (${session.completeness}%)**\n\n` +
      `${formatScorecard(session)}\n\n---\n\n${draft}\n\n---\n` +
      `Reply **confirm** to finalize, or reply with corrections.`
    );
    return;
  }

  await message.reply(
    `**${session.id} — Round ${session.rounds} (${session.completeness}%)**\n\n` +
    `${formatScorecard(session)}\n\n---\n${generateQuestions(session.dimensions)}`
  );
}
```

### Step 7: Generate the Final Claude Code Prompt

Assemble all collected context into the structured output format using the LLM.

```javascript
async function generateFinalPrompt(session) {
  const ctx = session.context;
  const assemblyPrompt = `Assemble a structured Claude Code implementation prompt from these context notes.

Context per dimension:
- Project: ${ctx.project || 'Not specified'}
- Scope: ${ctx.scope || 'Not specified'}
- Criteria: ${ctx.criteria || 'Not specified'}
- Constraints: ${ctx.constraints || 'Not specified'}
- Existing Code: ${ctx.existing_code || 'Not specified'}
- Testing: ${ctx.testing || 'Not specified'}
- Deployment: ${ctx.deployment || 'Not specified'}
- Edge Cases: ${ctx.edge_cases || 'Not specified'}

Use this structure: Project Context (Repository, Stack, Architecture, Key Files) > Feature title > What to Build > Requirements > Out of Scope > Acceptance Criteria > Technical Constraints > Existing Code Context > Testing Plan > Deployment > Edge Cases & Error Handling.

Rules: Use actual details provided. For "Not specified" dimensions write "TBD". Keep it concrete and actionable.`;

  return await llm.complete(assemblyPrompt);
}
```

### Step 8: Confirm, Archive, and Template Save

```javascript
async function confirmAndFinalize(message, session) {
  if (!session.draftPrompt) {
    session.draftPrompt = await generateFinalPrompt(session);
  }

  const archive = loadJSON(ARCHIVE_PATH) || { prompts: [], templates: [] };
  archive.prompts.push({
    id: session.id, status: 'confirmed',
    created: new Date(session.messageIds[0]).toISOString(),
    confirmed: new Date().toISOString(),
    author: session.author, raw_input: session.raw_input,
    rounds: session.rounds, dimensions: session.dimensions,
    completeness_score: session.completeness, final_prompt: session.draftPrompt
  });
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2));

  await message.reply(
    `**${session.id} — Confirmed**\n\n` +
    `Completeness: **${session.completeness}%** | Rounds: **${session.rounds}**\n\n` +
    `Copy the prompt below and paste it into Claude Code:\n\n` +
    `\`\`\`markdown\n${session.draftPrompt}\n\`\`\`\n\n` +
    `Saved to archive. React with clipboard to also save as a reusable template.`
  );
  activeSessions.delete(session.id);
}

// Reaction handlers: thumbs-up confirms draft, clipboard saves as template
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.channel.name !== 'context-crafter') return;
  if (!isAuthorizedUser(user.id)) return;

  if (reaction.emoji.name === '👍') {
    const session = findSessionByMessageChannel(reaction.message.channel.id, user.id);
    if (session) await confirmAndFinalize(reaction.message, session);
  }

  if (reaction.emoji.name === '📋') {
    const archive = loadJSON(ARCHIVE_PATH) || { prompts: [], templates: [] };
    const prompt = archive.prompts.find(p => p.author === user.id && p.status === 'confirmed');
    if (prompt) {
      const templateId = `CT-${String(archive.templates.length + 1).padStart(4, '0')}`;
      archive.templates.push({
        id: templateId, source_prompt: prompt.id, created: new Date().toISOString(),
        dimensions_profile: prompt.dimensions, final_prompt: prompt.final_prompt, times_reused: 0
      });
      fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2));
      await reaction.message.channel.send(`Template **${templateId}** saved from **${prompt.id}**.`);
    }
  }
});
```

## Correction Handling

When a user replies with corrections after a draft is shown, re-run assembly with feedback integrated.

```javascript
async function handleCorrection(message, session, corrections) {
  const revisionPrompt = `Revise this Claude Code implementation prompt based on user feedback.

Current prompt:
${session.draftPrompt}

User feedback: "${corrections}"

Apply the feedback precisely. Keep the same section structure. Return the full revised prompt.`;

  session.draftPrompt = await llm.complete(revisionPrompt);
  session.rounds += 1;

  await message.reply(
    `**${session.id} — Revision ${session.rounds}**\n\n${session.draftPrompt}\n\n---\n` +
    `Reply **confirm** to finalize, or reply with more corrections.`
  );
}
```

## Archive Queries

```bash
# List confirmed prompts
jq '.prompts[] | select(.status == "confirmed") | {id, completeness_score, rounds}' \
  ~/.agents/data/context-prompts.json

# Get a specific prompt's final output
jq -r --arg id "CP-0001" '.prompts[] | select(.id == $id) | .final_prompt' \
  ~/.agents/data/context-prompts.json

# List saved templates
jq '.templates[] | {id, source_prompt, times_reused}' \
  ~/.agents/data/context-prompts.json
```

## Tips

- **80% completeness** is the sweet spot. Below that, Claude Code makes too many assumptions. Above 90% is diminishing returns.
- Most commonly missed dimension: **Existing Code Context**. Always ask about codebase patterns.
- Cap sessions at **8 rounds**. If still sparse, the feature needs breaking down first.
- Encourage **file paths, function names, and code snippets** in replies -- concrete beats abstract.
- Templates compound over time. The 11th prompt takes half the rounds because project context is scaffolded.
- `messageIds` in the session enables reply-thread detection even when conversations interleave.
