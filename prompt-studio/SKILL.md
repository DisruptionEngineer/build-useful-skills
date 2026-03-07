---
name: prompt-studio
description: Collaboratively refine raw prompt ideas into polished, production-ready prompts via Discord reply threads. Use when a user posts a new prompt idea in #prompt-engineer, iterating on AI prompts through back-and-forth replies, or publishing an approved final prompt as a standalone post in #prompt-library. All bot messages are replies to keep the main channel thread clean.
metadata: {"clawdbot":{"emoji":"🎨","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Prompt Studio

Listen on `#prompt-engineer` for new (non-reply) messages from authorized users. Each new message starts a refinement session for a raw prompt idea. React with emoji to acknowledge, then engage via replies only — never posting new standalone messages in the channel. When the user reacts with ✅ to approve the final version, post the finished prompt as a clean standalone message in `#prompt-library` and archive it locally.

## When to Use

- A user posts a raw prompt idea in `#prompt-engineer` and wants it polished
- Iterating on an AI prompt through reply-based back-and-forth conversation
- Suggesting structural improvements, clearer constraints, or stronger framing
- The user is ready to publish a finalized prompt to `#prompt-library`
- Reviewing and revising a prompt draft based on user corrections via replies
- Archiving approved prompts in `~/.agents/data/prompt-library.json` for future reuse

## Prerequisites

### Shared Bot

Same OpenClaw Discord bot as the rest of the pipeline.

```bash
echo $DISCORD_BOT_TOKEN
```

### Channel Permissions

The bot needs `READ_MESSAGES`, `SEND_MESSAGES`, `ADD_REACTIONS`, and `MANAGE_MESSAGES` in:
- `#prompt-engineer` (refinement channel)
- `#prompt-library` (output channel for approved prompts)

The bot also needs `GuildMessageReactions` intent to detect approval reactions.

```bash
openclaw channels resolve prompt-engineer
openclaw channels resolve prompt-library
```

### Data File

Initialize the prompt archive if it doesn't exist.

```bash
mkdir -p ~/.agents/data
if [ ! -f ~/.agents/data/prompt-library.json ]; then
  echo '{"prompts": []}' > ~/.agents/data/prompt-library.json
fi
```

### Prompt Archive Schema

```json
{
  "prompts": [
    {
      "id": "PS-0001",
      "status": "published",
      "created": "2026-03-01T10:00:00.000Z",
      "published": "2026-03-01T10:20:00.000Z",
      "author_discord_id": "123456789012345678",
      "raw_input": "a prompt that helps debug React components",
      "rounds": 2,
      "final_prompt": "You are a senior React engineer...",
      "library_message_id": "9876543210987654321",
      "tags": ["react", "debugging", "frontend"]
    }
  ]
}
```

## Emoji Reaction Protocol

| Emoji | Meaning | Who adds it |
|-------|---------|-------------|
| 💡 | Session started, bot is analyzing | Bot (immediately on new message) |
| ✏️ | First draft is ready in reply | Bot (after posting initial reply) |
| 🔄 | Revision posted | Bot (on each round after corrections) |
| ✅ | Prompt approved — publish to #prompt-library | **User** (triggers publication) |
| 📌 | Published to #prompt-library | Bot (after successful publication) |

## Step-by-Step Implementation

### Step 1: Detect New Sessions vs Replies

Only new (non-reply) messages in `#prompt-engineer` start sessions. Replies are handled by `handleReply`.

```javascript
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LIBRARY_PATH = path.join(process.env.HOME, '.agents', 'data', 'prompt-library.json');
const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const activeSessions = new Map(); // sessionId → session object
const messageToSession = new Map(); // messageId → sessionId

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
  if (message.channel.name !== 'prompt-engineer') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const isReply = !!message.reference?.messageId;

  if (isReply) {
    const session = findSessionByReply(message);
    if (session) {
      await handleReply(message, session);
    }
    return;
  }

  // New standalone message = new session
  await startSession(message);
});
```

### Step 2: Start a Session

React immediately, then post an initial refined version as a reply.

```javascript
async function startSession(message) {
  try {
    const library = loadJSON(LIBRARY_PATH) || { prompts: [] };
    const sessionId = `PS-${String(library.prompts.length + 1).padStart(4, '0')}`;

    // React instantly to signal the bot is working
    await message.react('💡');

    const session = {
      id: sessionId,
      authorId: message.author.id,
      rawInput: message.content,
      currentDraft: null,
      rounds: 0,
      messageIds: [message.id],
      rootMessageId: message.id
    };

    activeSessions.set(sessionId, session);
    messageToSession.set(message.id, sessionId);

    // Generate initial analysis and first draft
    const analysis = analyzePrompt(message.content);
    const draft = await generateImprovedPrompt(message.content, null, analysis);
    session.currentDraft = draft;
    session.rounds = 1;

    const replyText = buildDraftReply(sessionId, draft, analysis, 1);
    const botReply = await message.reply(replyText);

    // React to the bot's own reply to indicate draft is ready
    await message.react('✏️');
    session.messageIds.push(botReply.id);
    messageToSession.set(botReply.id, sessionId);
  } catch (err) {
    console.error(`[prompt-studio] startSession error:`, err);
    await message.reply(`Failed to start refinement session: ${err.message}`);
  }
}
```

### Step 3: Analyze the Raw Prompt

Detect structural weaknesses without rigid dimension scoring — just actionable notes.

```javascript
function analyzePrompt(text) {
  const issues = [];
  const strengths = [];

  // Role / persona
  if (/^you are|^act as|^your role|^you're a/i.test(text.trim())) {
    strengths.push('Has a clear persona/role definition');
  } else {
    issues.push('No role or persona defined — add "You are a [role]..." opener');
  }

  // Output format
  if (/\b(format|output|return|respond with|structured|markdown|json|list|bullet|numbered)\b/i.test(text)) {
    strengths.push('Specifies output format');
  } else {
    issues.push('Output format unspecified — define how the response should be structured');
  }

  // Constraints / guardrails
  if (/\b(do not|don't|never|avoid|only|must|always|limit|maximum|minimum)\b/i.test(text)) {
    strengths.push('Has constraints or guardrails');
  } else {
    issues.push('No constraints defined — add explicit do/don\'t rules to bound behavior');
  }

  // Examples
  if (/\b(example|e\.g\.|for instance|such as|like|sample)\b/i.test(text)) {
    strengths.push('Includes examples or references');
  } else {
    issues.push('No examples provided — a concrete example dramatically improves consistency');
  }

  // Context / background
  if (text.length > 200) {
    strengths.push('Sufficient length with context');
  } else if (text.length < 80) {
    issues.push('Very short — likely missing context, constraints, or expected output');
  }

  // Tone
  if (/\b(tone|style|voice|formal|casual|technical|friendly|concise|detailed)\b/i.test(text)) {
    strengths.push('Tone/style specified');
  } else {
    issues.push('Tone unspecified — consider adding target audience and register');
  }

  return { issues, strengths };
}
```

### Step 4: Generate Improved Prompt Draft

```javascript
async function generateImprovedPrompt(rawText, previousDraft, analysis, corrections = null) {
  const issueList = analysis.issues.map(i => `- ${i}`).join('\n');
  const strengthList = analysis.strengths.map(s => `✓ ${s}`).join('\n');

  let systemPrompt = `You are a professional prompt engineer. Your job is to transform a raw prompt idea into a polished, production-ready AI prompt.

A great prompt has:
1. A clear role/persona opener ("You are a...")
2. Explicit task description with context
3. Defined output format (list, JSON, prose, etc.)
4. Constraints and guardrails (what NOT to do)
5. At least one example or reference case
6. Specified tone/audience

Return ONLY the improved prompt. No commentary, no preamble, no markdown wrapping.`;

  let userPrompt;

  if (corrections && previousDraft) {
    userPrompt = `Revise this prompt based on the user's feedback.

Current prompt:
${previousDraft}

User feedback:
"${corrections}"

Apply the feedback precisely. Maintain the overall structure unless feedback indicates otherwise.`;
  } else {
    userPrompt = `Improve this raw prompt idea:

"${rawText}"

Issues to fix:
${issueList || '(none detected)'}

Existing strengths to keep:
${strengthList || '(none detected)'}

Return the improved, complete prompt only.`;
  }

  const response = await llm.complete(systemPrompt, userPrompt);
  return response.trim();
}
```

### Step 5: Format the Draft Reply

```javascript
function buildDraftReply(sessionId, draft, analysis, round) {
  const issueLines = analysis.issues.length
    ? `**Issues addressed:**\n${analysis.issues.map(i => `• ~~${i.slice(0, 60)}~~`).join('\n')}\n\n`
    : '';

  const strengthLines = analysis.strengths.length
    ? `**Kept:**\n${analysis.strengths.map(s => `• ${s}`).join('\n')}\n\n`
    : '';

  return [
    `**${sessionId} — Draft ${round}**`,
    ``,
    `\`\`\``,
    draft,
    `\`\`\``,
    ``,
    issueLines + strengthLines,
    `---`,
    `Reply with corrections, or react ✅ to approve and publish to #prompt-library.`
  ].join('\n');
}
```

### Step 6: Handle Correction Replies

When the user replies with feedback, regenerate and post a new revision.

```javascript
async function handleReply(message, session) {
  const text = message.content.trim().toLowerCase();

  // Explicit confirmation via text (belt-and-suspenders alongside reaction)
  if (['confirm', 'looks good', 'approve', 'done', 'publish', 'ship it'].includes(text)) {
    await publishPrompt(message, session);
    return;
  }

  if (['cancel', 'abort', 'stop', 'reset'].includes(text)) {
    activeSessions.delete(session.id);
    for (const [mid, sid] of messageToSession) {
      if (sid === session.id) messageToSession.delete(mid);
    }
    await message.react('🗑️');
    await message.reply(`Session **${session.id}** cancelled.`);
    return;
  }

  session.rounds += 1;
  if (session.rounds > 10) {
    await message.reply(
      `**${session.id}** has reached 10 rounds. Reply \`confirm\` to publish as-is, ` +
      `or \`reset\` to start over.`
    );
    return;
  }

  try {
    await message.react('🔄');

    const analysis = analyzePrompt(session.currentDraft);
    const revised = await generateImprovedPrompt(
      session.rawInput,
      session.currentDraft,
      analysis,
      message.content  // user's correction feedback
    );

    session.currentDraft = revised;
    session.messageIds.push(message.id);

    const replyText = buildRevisionReply(session.id, revised, session.rounds);
    const botReply = await message.reply(replyText);

    session.messageIds.push(botReply.id);
    messageToSession.set(botReply.id, session.id);
  } catch (err) {
    console.error(`[prompt-studio] handleReply error:`, err);
    await message.reply(`Revision failed: ${err.message}`);
  }
}

function buildRevisionReply(sessionId, draft, round) {
  return [
    `**${sessionId} — Revision ${round}**`,
    ``,
    `\`\`\``,
    draft,
    `\`\`\``,
    ``,
    `---`,
    `Reply with more corrections, or react ✅ to approve and publish.`
  ].join('\n');
}
```

### Step 7: Detect Approval Reaction (✅)

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.channel.name !== 'prompt-engineer') return;
  if (!isAuthorizedUser(user.id)) return;

  // Fetch partial reactions if needed
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  if (reaction.emoji.name !== '✅') return;

  // Find the session associated with the reacted message
  const sessionId = messageToSession.get(reaction.message.id);
  if (!sessionId) return;

  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Only the session author can approve
  if (user.id !== session.authorId) return;

  await publishPrompt(reaction.message, session);
});
```

### Step 8: Publish to #prompt-library

The final prompt is posted as a clean, standalone message in `#prompt-library` — no reply context, no session metadata, just the prompt.

```javascript
async function publishPrompt(triggerMessage, session) {
  try {
    const guild = triggerMessage.guild;
    const libraryChannel = guild.channels.cache.find(c => c.name === 'prompt-library');

    if (!libraryChannel) {
      await triggerMessage.reply(
        `Can't find **#prompt-library**. Create the channel first or check bot permissions.`
      );
      return;
    }

    // Extract tags from the final prompt content
    const tags = extractTags(session.currentDraft);

    // Build the library post — clean and self-contained
    const libraryPost = buildLibraryPost(session, tags);
    const libraryMessage = await libraryChannel.send(libraryPost);

    // Archive locally
    const library = loadJSON(LIBRARY_PATH) || { prompts: [] };
    library.prompts.push({
      id: session.id,
      status: 'published',
      created: new Date(Date.now() - session.rounds * 60000).toISOString(),
      published: new Date().toISOString(),
      author_discord_id: session.authorId,
      raw_input: session.rawInput,
      rounds: session.rounds,
      final_prompt: session.currentDraft,
      library_message_id: libraryMessage.id,
      tags
    });
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));

    // React 📌 on the original root message to indicate it's published
    try {
      const rootMessage = await triggerMessage.channel.messages.fetch(session.rootMessageId);
      await rootMessage.react('📌');
    } catch {}

    // Confirm in prompt-engineer via reply
    await triggerMessage.reply(
      `**${session.id}** published ✅\n` +
      `Rounds: **${session.rounds}** | Tags: ${tags.length ? tags.map(t => `\`${t}\``).join(' ') : 'none'}\n` +
      `→ #prompt-library`
    );

    // Clean up session
    activeSessions.delete(session.id);
    for (const [mid, sid] of messageToSession) {
      if (sid === session.id) messageToSession.delete(mid);
    }
  } catch (err) {
    console.error(`[prompt-studio] publishPrompt error:`, err);
    await triggerMessage.reply(`Publication failed: ${err.message}`);
  }
}

function buildLibraryPost(session, tags) {
  const tagLine = tags.length ? `\n**Tags:** ${tags.map(t => `\`${t}\``).join(' ')}` : '';
  const meta = `**ID:** \`${session.id}\` | **Rounds:** ${session.rounds}${tagLine}`;

  return [
    meta,
    ``,
    session.currentDraft
  ].join('\n');
}

function extractTags(promptText) {
  const tagMap = {
    'react': ['react', 'jsx', 'tsx', 'component', 'hook'],
    'python': ['python', 'django', 'flask', 'fastapi', 'pandas'],
    'debugging': ['debug', 'error', 'bug', 'fix', 'issue', 'trace'],
    'writing': ['write', 'essay', 'blog', 'article', 'draft', 'tone'],
    'code-review': ['review', 'code review', 'pr', 'pull request'],
    'data': ['data', 'csv', 'json', 'sql', 'database', 'query'],
    'testing': ['test', 'unit test', 'spec', 'jest', 'pytest'],
    'api': ['api', 'endpoint', 'rest', 'graphql', 'webhook'],
    'security': ['security', 'auth', 'token', 'permission', 'vulnerability'],
    'ux': ['ux', 'ui', 'design', 'user experience', 'interface'],
    'devops': ['deploy', 'docker', 'ci', 'cd', 'pipeline', 'kubernetes'],
    'ai': ['llm', 'gpt', 'claude', 'prompt', 'chain', 'agent']
  };

  const lower = promptText.toLowerCase();
  return Object.entries(tagMap)
    .filter(([, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([tag]) => tag);
}
```

### Step 9: Session Lookup Helpers

```javascript
function findSessionByReply(message) {
  const refId = message.reference?.messageId;
  if (!refId) return null;

  // Direct lookup in message-to-session map
  const sessionId = messageToSession.get(refId);
  if (sessionId) return activeSessions.get(sessionId);

  // Fallback: check if any session belongs to this author in this channel
  for (const [, session] of activeSessions) {
    if (session.authorId === message.author.id) return session;
  }
  return null;
}

function isAuthorizedUser(discordId) {
  try {
    const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return config.authorized_users.some(u => u.discord_id === discordId);
  } catch { return false; }
}
```

## Archive Queries

```bash
# List all published prompts with tags
jq '.prompts[] | select(.status == "published") | {id, tags, rounds, raw_input}' \
  ~/.agents/data/prompt-library.json

# Find prompts by tag
jq '.prompts[] | select(.tags | contains(["react"])) | {id, raw_input}' \
  ~/.agents/data/prompt-library.json

# Get the full text of a specific prompt
jq -r '.prompts[] | select(.id == "PS-0001") | .final_prompt' \
  ~/.agents/data/prompt-library.json

# Count prompts by tag
jq '[.prompts[].tags[]] | group_by(.) | map({tag: .[0], count: length}) | sort_by(-.count)' \
  ~/.agents/data/prompt-library.json

# Export a prompt to markdown
jq -r '.prompts[] | select(.id == "PS-0001") | .final_prompt' \
  ~/.agents/data/prompt-library.json > ~/Desktop/PS-0001.md
```

## Error Handling

```javascript
client.on('error', (err) => console.error('[prompt-studio] Client error:', err));

process.on('unhandledRejection', (err) => {
  console.error('[prompt-studio] Unhandled rejection:', err);
});
```

## Registering the Bot

```javascript
client.once('ready', () => {
  console.log(`[prompt-studio] Online as ${client.user.tag}`);
  console.log(`[prompt-studio] Watching #prompt-engineer → #prompt-library`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

## Tips

- All bot messages must be `message.reply()` calls, never `channel.send()` in `#prompt-engineer`. This is what keeps the main channel feed clean — each session's thread is visually scoped under the user's original post.
- The ✅ reaction is the only path to publication. Text-based "confirm" is a convenience shortcut, but the emoji is the primary UX because it's frictionless.
- The `messageToSession` map is the key data structure. Every message involved in a session (user messages and bot replies) gets registered here so reply-chain detection works reliably even when messages interleave.
- `extractTags` is heuristic — it improves over time as you add keywords to `tagMap`. Tags drive searchability in the archive.
- Cap rounds at 10. If a prompt needs more than 10 back-and-forths it probably needs to be split into two separate prompts.
- The library post in `#prompt-library` deliberately has no bot metadata header ("Session started...", "Round 3 of ..."). It's a clean artifact meant to be read and reused, not a process log.
- Use `Partials.Message`, `Partials.Reaction`, and `Partials.User` in the client intents — without them, reactions on older cached messages silently fail.
- The `GatewayIntentBits.GuildMessageReactions` intent must be enabled in the Discord Developer Portal under the bot's "Privileged Gateway Intents" section, in addition to being in the code.
- `MANAGE_MESSAGES` permission in `#prompt-engineer` is optional but useful for the bot to remove its own intermediate messages if you want to clean up after publication.
- The `llm.complete()` calls assume OpenClaw's shared LLM interface. Substitute your actual LLM wrapper here — the prompt logic is model-agnostic.
