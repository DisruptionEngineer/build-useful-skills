---
name: print-evaluator
description: Automatically score 3D print requests on Printability, Complexity, Priority, and Print Time axes, then route them through the print pipeline with reaction-based approval. Use when triaging new print requests, assessing model difficulty from URL metadata, approving or rejecting requests via Discord reactions, fast-tracking urgent prints, or posting evaluation scorecards to #print-requests. Communicates upstream with print-request-inbox and downstream with print-queue-manager.
metadata: {"clawdbot":{"emoji":"📋","requires":{"anyBins":["jq","curl"]},"os":["linux","darwin","win32"]}}
---

# Print Evaluator

Watch `#print-requests` for `[SYSTEM] EVALUATE_REQUEST PR-XXXX` messages. Score each request on four axes — Printability, Complexity, Priority, and Print Time — and post a scorecard embed. Route requests based on scores: complex prints go to `#print-review` for manual inspection, simple high-priority prints can be fast-tracked to `#print-queue`. Handle approval, rejection, notes, and priority adjustment via emoji reactions.

## When to Use

- A new `[SYSTEM] EVALUATE_REQUEST` message appears in `#print-requests`
- Triaging a batch of unscored print requests
- Deciding which prints to queue first based on objective criteria
- Automatically flagging complex multi-part models for manual review
- Approving or rejecting a request via reactions (✅ ❌ ✏️ 🔼 🔽)

## Prerequisites

### Shared Bot

This skill uses the OpenClaw Discord bot — no separate bot configuration needed.

### Channel Permissions

The bot needs `SEND_MESSAGES` and `ADD_REACTIONS` permission in:
- `#print-requests` (for scorecards and reaction controls)
- `#print-queue` (for forwarding approved requests)

### Queue File

The queue must exist and contain requests from the print-request-inbox skill.

```bash
# Verify queue exists and has new requests
jq '.requests[] | select(.status == "new") | .id' ~/.agents/data/print-queue.json
```

## Scoring Axes

### Printability (1–5)

How reliable is this model likely to be?

| Score | Criteria | Example |
|-------|----------|---------|
| 1 | Unknown source, no reviews | Random file download |
| 2 | Unknown URL or text-only description | "I need a phone holder" |
| 3 | Thingiverse model — check reviews | thingiverse.com/thing:12345 |
| 4 | MakerWorld or Printables — community rated | makerworld.com/models/12345 |
| 5 | Known-good source + metadata confirmed | MakerWorld + OG tags extracted |

### Complexity (1–5)

How difficult is this to print?

| Score | Criteria | Keywords |
|-------|----------|----------|
| 1 | Trivial single piece, no supports | cap, ring, washer |
| 2 | Simple functional part | hook, clip, holder, stand, mount, bracket |
| 3 | Moderate — may need supports | enclosure, box, case |
| 4 | Multi-part or articulated | multi-part, assembly, articulated, mechanical |
| 5 | Complex assembly with tight tolerances | gears, threads, snap-fit assemblies |

### Priority (1–5)

How urgently is this needed?

| Score | Criteria | Example |
|-------|----------|---------|
| 1 | Just curious, no real need | "this looks cool" |
| 2 | Nice to have, no timeline | Decorative item |
| 3 | Normal — would use it when done | Desk organizer |
| 4 | Needed soon — functional part or gift | Replacement knob, birthday gift |
| 5 | Urgent — something is broken | Broken appliance part |

### Print Time Estimate

| Category | Duration | Example |
|----------|----------|---------|
| Quick | Under 2 hours | Small clips, phone stands |
| Medium | 2–8 hours | Enclosures, mid-size models |
| Long | 8+ hours | Large prints, articulated models |

## Scoring Logic

### Step 1: Watch for Evaluate Messages

Listen in `#print-requests` for system triggers.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'print-requests') return;
  const match = message.content.match(/\[SYSTEM\] EVALUATE_REQUEST (PR-\d{4})/);
  if (!match) return;
  await evaluateRequest(match[1], message.channel);
});
```

### Step 2: Load and Score the Request

```javascript
function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

async function evaluateRequest(requestId, channel) {
  const queue = loadJSON(QUEUE_PATH) || { requests: [] };
  const request = queue.requests.find(r => r.id === requestId);
  if (!request || request.status !== 'new') return;

  const scores = scoreRequest(request);
  request.scores = scores;
  request.status = 'evaluated';
  request.priority = scores.priority;

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
  await postScorecard(channel, request, scores);
}
```

### Step 3: Heuristic Scoring

```javascript
function scoreRequest(request) {
  const source = request.source || 'text';
  const hasUrl = Boolean(request.url);
  const hasName = Boolean(request.model_name);
  const raw = ((request.raw_text || '') + ' ' + (request.model_name || '')).toLowerCase();

  // Printability
  let printability = 2;
  let printability_reason = 'Text description only — needs model search';
  if (source === 'makerworld' || source === 'printables') {
    printability = 4;
    printability_reason = 'Known source with community ratings';
  } else if (source === 'thingiverse') {
    printability = 3;
    printability_reason = 'Thingiverse model — check reviews';
  }
  if (hasName && hasUrl) {
    printability = Math.min(5, printability + 1);
    printability_reason += ' + metadata extracted';
  }

  // Complexity
  let complexity = 3;
  let complexity_reason = 'Default estimate — inspect model for details';
  const complexKeywords = ['multi-part', 'multipart', 'assembly', 'articulated', 'mechanical', 'gear'];
  const simpleKeywords = ['hook', 'clip', 'holder', 'stand', 'mount', 'bracket', 'cap', 'ring'];
  if (complexKeywords.some(kw => raw.includes(kw))) {
    complexity = 4;
    complexity_reason = 'Keywords suggest multi-part or complex model';
  } else if (simpleKeywords.some(kw => raw.includes(kw))) {
    complexity = 2;
    complexity_reason = 'Keywords suggest simple single-piece model';
  }

  // Priority — default to 3, adjustable via reactions
  let priority = 3;
  let priority_reason = 'Normal priority';
  const urgentKeywords = ['broken', 'replacement', 'urgent', 'need', 'asap'];
  const giftKeywords = ['gift', 'birthday', 'christmas', 'present', 'surprise'];
  if (urgentKeywords.some(kw => raw.includes(kw))) {
    priority = 4;
    priority_reason = 'Keywords suggest urgency';
  } else if (giftKeywords.some(kw => raw.includes(kw))) {
    priority = 4;
    priority_reason = 'Gift — time-sensitive';
  }

  // Time estimate
  let time_estimate = 'medium';
  if (complexity <= 2) time_estimate = 'quick';
  if (complexity >= 4) time_estimate = 'long';

  return {
    printability, printability_reason,
    complexity, complexity_reason,
    priority, priority_reason,
    time_estimate
  };
}
```

### Step 4: Post Scorecard to #print-requests

```javascript
async function postScorecard(channel, request, scores) {
  const bar = (n) => '█'.repeat(n) + '░'.repeat(5 - n);
  const total = scores.printability + (6 - scores.complexity) + scores.priority;

  const embed = {
    title: `📋 Evaluation — ${request.id}`,
    description: request.model_name || request.raw_text?.substring(0, 200),
    fields: [
      {
        name: `Printability [${bar(scores.printability)}] ${scores.printability}/5`,
        value: scores.printability_reason, inline: false
      },
      {
        name: `Complexity [${bar(scores.complexity)}] ${scores.complexity}/5`,
        value: scores.complexity_reason, inline: false
      },
      {
        name: `Priority [${bar(scores.priority)}] ${scores.priority}/5`,
        value: scores.priority_reason, inline: false
      },
      { name: 'Time Estimate', value: `⏱️ ${scores.time_estimate}`, inline: true },
      { name: 'Routing', value: getRoutingDecision(scores), inline: true }
    ],
    footer: { text: '✅ Approve  ❌ Reject  ✏️ Notes  🔼 Bump  🔽 Lower' },
    color: total >= 10 ? 0x2ECC71 : total >= 7 ? 0xF1C40F : 0xE74C3C,
    timestamp: new Date().toISOString()
  };

  const msg = await channel.send({ embeds: [embed] });
  for (const emoji of ['✅', '❌', '✏️', '🔼', '🔽']) {
    await msg.react(emoji);
  }
}
```

### Step 5: Route Based on Scores

```javascript
function getRoutingDecision(scores) {
  if (scores.complexity >= 4) {
    return '🔍 → #print-review (complex model, needs manual review)';
  }
  if (scores.priority >= 4 && scores.printability >= 4 && scores.complexity <= 2) {
    return '🚀 → #print-queue (FAST-TRACK)';
  }
  return '→ Awaiting approval via reactions';
}
```

## Reaction Controls

| Reaction | Action |
|----------|--------|
| ✅ | Approve — moves to `queued`, forwards to `#print-queue` |
| ❌ | Reject — marks as `rejected` |
| ✏️ | Add notes — bot asks for text (60s timeout) |
| 🔼 | Bump priority up by 1 (max 5) |
| 🔽 | Lower priority by 1 (min 1) |

### Approval Handler

```javascript
// On ✅ reaction from authorized user
async function approveRequest(requestId, channel) {
  updateRequestStatus(requestId, 'queued');
  const request = getRequest(requestId);
  const queueChannel = client.channels.cache.find(c => c.name === 'print-queue');
  await queueChannel.send(
    `📨 **New in Queue — ${requestId}**\n` +
    `**Model:** ${request.model_name || request.raw_text}\n` +
    `**Priority:** ${request.priority}/5\n` +
    `**Time Est:** ${request.scores.time_estimate}\n` +
    `\n[SYSTEM] QUEUE_REQUEST ${requestId}`
  );
  await channel.send(`✅ **${requestId}** approved and moved to queue!`);
}
```

## Update Backlog via Shell

```bash
# Update status to evaluated
jq --arg id "$REQUEST_ID" \
   --argjson scores "$SCORES_JSON" \
   '(.requests[] | select(.id == $id)) |= . + {
     status: "evaluated",
     scores: $scores,
     priority: ($scores.priority)
   }' ~/.agents/data/print-queue.json > /tmp/pq-tmp.json \
   && mv /tmp/pq-tmp.json ~/.agents/data/print-queue.json

# Approve a request (move to queued)
jq --arg id "PR-0001" \
   '(.requests[] | select(.id == $id)).status = "queued"' \
   ~/.agents/data/print-queue.json > /tmp/pq-tmp.json \
   && mv /tmp/pq-tmp.json ~/.agents/data/print-queue.json
```

## Tips

- The scoring rubric is heuristic-based for speed. For higher accuracy, use the LLM to score with the full rubric in the prompt.
- Fast-track threshold is deliberately strict: priority ≥ 4 AND printability ≥ 4 AND complexity ≤ 2. Most prints should go through normal approval.
- Always post the scorecard even for low-scoring models. Transparency helps users understand why something was flagged.
- Reactions are tracked per scorecard message. Multiple scorecards can be pending simultaneously.
- Priority adjustments via reactions stack — tap 🔼 twice to go from 3 to 5.
- The 60-second note timeout prevents the bot from hanging. If the user needs more time, they can add notes via a follow-up message.
- Color-code embeds: green (high confidence), yellow (moderate), red (needs attention).
- Complex models (complexity ≥ 4) auto-route to `#print-review` for manual inspection before queuing.
