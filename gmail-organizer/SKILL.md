---
name: gmail-organizer
description: Organize a Gmail inbox by creating labels, applying filters, categorizing and moving emails, and drafting responses without ever sending messages. Use when sorting incoming emails by sender or subject, bulk labeling old messages, creating filter rules for auto-categorization, preparing draft responses for manual review, auditing inbox structure for migration to Proton Mail, or cleaning up newsletters and notification clutter. Read-only and draft-only — never sends or permanently deletes.
metadata: {"clawdbot":{"emoji":"📧","requires":{"anyBins":["node","jq"]},"os":["linux","darwin"]}}
---

# Gmail Organizer

Organize the Gmail inbox for `dmattson507@gmail.com` using the Gmail API. Create a label taxonomy, apply filters for auto-categorization, move existing emails into labeled folders, and draft responses where needed. This skill is strictly read-only plus drafts — it never sends emails and never permanently deletes anything. All operations are logged to an audit trail for reversibility. This is Phase 1 of a planned migration from Gmail to Proton Mail.

## When to Use

- Sorting incoming emails by sender domain, subject patterns, or content type
- Creating a label taxonomy (work, personal, newsletters, receipts, notifications, action-required)
- Applying Gmail filters to auto-label future incoming mail
- Bulk moving existing emails into appropriate labels based on categorization rules
- Preparing draft responses for flagged messages (for manual review and sending later)
- Auditing inbox structure and generating statistics for migration planning
- Cleaning up newsletter subscriptions and notification clutter

## Prerequisites

### Gmail API Credentials

Set up a Google Cloud project with the Gmail API enabled. Create OAuth2 credentials (Desktop app type). Download the credentials JSON.

```bash
# Store credentials in the agents config directory
mkdir -p ~/.agents/config
# Place your downloaded credentials file here:
# ~/.agents/config/gmail-credentials.json

ls ~/.agents/config/gmail-credentials.json
```

### Required OAuth2 Scopes

Request ONLY these scopes. Explicitly exclude `gmail.send`.

```javascript
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',    // Read messages and labels
  'https://www.googleapis.com/auth/gmail.modify',      // Modify labels, move messages
  'https://www.googleapis.com/auth/gmail.labels',      // Create and manage labels
  'https://www.googleapis.com/auth/gmail.compose',     // Create drafts (NOT send)
];

// NEVER include these scopes:
// 'https://www.googleapis.com/auth/gmail.send'         -- PROHIBITED
// 'https://mail.google.com/'                            -- Too broad, includes send
```

### Install Dependencies

```bash
npm install googleapis@latest
npm install google-auth-library@latest
```

### Initialize Data Files

```bash
mkdir -p ~/.agents/data

# Audit trail — logs every action for reversibility
if [ ! -f ~/.agents/data/gmail-audit-trail.json ]; then
  echo '{"actions": []}' > ~/.agents/data/gmail-audit-trail.json
fi

# Label taxonomy — tracks created labels and their rules
if [ ! -f ~/.agents/data/gmail-label-taxonomy.json ]; then
  echo '{"labels": [], "filters": [], "stats": {}}' > ~/.agents/data/gmail-label-taxonomy.json
fi
```

## Authentication

### Step 1: OAuth2 Flow

Authenticate once, store the token for reuse. The token file is stored locally and never shared.

```javascript
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const CREDENTIALS_PATH = path.join(process.env.HOME, '.agents', 'config', 'gmail-credentials.json');
const TOKEN_PATH = path.join(process.env.HOME, '.agents', 'config', 'gmail-token.json');

async function getGmailClient() {
  let auth;

  // Try to load existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = loadJSON(TOKEN_PATH);
    const credentials = loadJSON(CREDENTIALS_PATH);
    if (!token || !credentials) {
      return await authenticateFresh();
    }
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(token);

    // Check if token is expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      try {
        const { credentials: refreshed } = await auth.refreshAccessToken();
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(refreshed, null, 2));
        auth.setCredentials(refreshed);
      } catch (err) {
        console.warn('[gmail-organizer] Token refresh failed, re-authenticating...');
        auth = await authenticateFresh();
      }
    }
  } else {
    auth = await authenticateFresh();
  }

  return google.gmail({ version: 'v1', auth });
}

async function authenticateFresh() {
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(auth.credentials, null, 2));
  return auth;
}
```

### Step 2: Verify Connection

```javascript
async function verifyConnection(gmail) {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log(`[gmail-organizer] Connected as: ${profile.data.emailAddress}`);
  console.log(`[gmail-organizer] Total messages: ${profile.data.messagesTotal}`);

  if (profile.data.emailAddress !== 'dmattson507@gmail.com') {
    throw new Error(
      `Connected to wrong account: ${profile.data.emailAddress}. ` +
      `Expected dmattson507@gmail.com`
    );
  }

  return profile.data;
}
```

## Label Taxonomy

### Step 3: Define and Create Labels

Create a structured label hierarchy for organizing mail.

```javascript
const LABEL_TAXONOMY = [
  { name: 'Organize/Work',           color: { backgroundColor: '#16a765', textColor: '#ffffff' } },
  { name: 'Organize/Personal',       color: { backgroundColor: '#4986e7', textColor: '#ffffff' } },
  { name: 'Organize/Newsletters',    color: { backgroundColor: '#b99aff', textColor: '#ffffff' } },
  { name: 'Organize/Receipts',       color: { backgroundColor: '#ffad47', textColor: '#000000' } },
  { name: 'Organize/Notifications',  color: { backgroundColor: '#a0c4ff', textColor: '#000000' } },
  { name: 'Organize/Action-Required', color: { backgroundColor: '#fb4c2f', textColor: '#ffffff' } },
  { name: 'Organize/Drafts-Pending', color: { backgroundColor: '#ffc8af', textColor: '#000000' } },
  { name: 'Migration/Export-Ready',  color: { backgroundColor: '#98d7e4', textColor: '#000000' } },
];

async function createLabels(gmail) {
  const existing = await gmail.users.labels.list({ userId: 'me' });
  const existingNames = new Set(existing.data.labels.map(l => l.name));
  const created = [];

  for (const label of LABEL_TAXONOMY) {
    if (existingNames.has(label.name)) {
      console.log(`[gmail-organizer] Label already exists: ${label.name}`);
      continue;
    }

    try {
      const result = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: label.name,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
          color: label.color,
        },
      });
      created.push({ name: label.name, id: result.data.id });
      logAction('label_created', { name: label.name, id: result.data.id });
    } catch (err) {
      if (err.code === 409) {
        console.warn(`[gmail-organizer] Label conflict: ${label.name} — skipping`);
      } else {
        console.error(`[gmail-organizer] Failed to create label ${label.name}:`, err.message);
      }
    }
  }

  return created;
}
```

### Step 4: Map Label IDs

```javascript
async function getLabelMap(gmail) {
  const response = await gmail.users.labels.list({ userId: 'me' });
  const map = {};
  for (const label of response.data.labels) {
    map[label.name] = label.id;
  }
  return map;
}
```

```bash
# Quick check of existing labels
jq -r '.labels[].name' ~/.agents/data/gmail-label-taxonomy.json 2>/dev/null
```

## Email Categorization

### Step 5: Scan and Categorize Emails

Fetch emails in batches and classify them by sender domain, subject patterns, and headers.

```javascript
const CATEGORIZATION_RULES = [
  {
    label: 'Organize/Newsletters',
    match: (msg) =>
      hasHeader(msg, 'List-Unsubscribe') ||
      /newsletter|digest|weekly|update/i.test(getSubject(msg)),
  },
  {
    label: 'Organize/Receipts',
    match: (msg) =>
      /receipt|invoice|order|payment|confirm/i.test(getSubject(msg)) ||
      /noreply|no-reply/i.test(getSender(msg)),
  },
  {
    label: 'Organize/Notifications',
    match: (msg) =>
      /notification|alert|reminder|automated/i.test(getSubject(msg)) ||
      /notifications?@/i.test(getSender(msg)),
  },
  {
    label: 'Organize/Work',
    match: (msg) => {
      const sender = getSender(msg).toLowerCase();
      const domain = (sender.match(/@([^\s>]+)/)?.[1]) || '';
      return domain && !/gmail|yahoo|hotmail|outlook|icloud|proton/i.test(domain);
    },
  },
  {
    label: 'Organize/Personal',
    match: (msg) =>
      /gmail|yahoo|hotmail|outlook|icloud|proton/i.test(getSender(msg)),
  },
];

function getSubject(msg) {
  const header = msg.payload.headers.find(h => h.name.toLowerCase() === 'subject');
  return header ? header.value : '';
}

function getSender(msg) {
  const header = msg.payload.headers.find(h => h.name.toLowerCase() === 'from');
  return header ? header.value : '';
}

function hasHeader(msg, name) {
  return msg.payload.headers.some(h => h.name.toLowerCase() === name.toLowerCase());
}
```

### Step 6: Fetch and Process Messages in Batches

Respect Gmail API rate limits with exponential backoff.

```javascript
async function categorizeInbox(gmail, labelMap, options = {}) {
  const maxResults = options.maxResults || 500;
  const query = options.query || 'in:inbox';
  const stats = { processed: 0, labeled: 0, skipped: 0, errors: 0 };
  let pageToken = null;

  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, maxResults - stats.processed),
      pageToken,
    });

    const messages = response.data.messages || [];

    for (const msgRef of messages) {
      if (stats.processed >= maxResults) break;

      try {
        await rateLimitDelay();
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'List-Unsubscribe', 'Date'],
        });

        const category = classifyMessage(msg.data);

        if (category && labelMap[category]) {
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgRef.id,
            requestBody: { addLabelIds: [labelMap[category]] },
          });
          stats.labeled++;
          logAction('email_labeled', {
            messageId: msgRef.id,
            label: category,
            subject: getSubject(msg.data).substring(0, 80),
          });
        } else {
          stats.skipped++;
        }
        stats.processed++;
      } catch (err) {
        if (err.code === 429) {
          console.warn('[gmail-organizer] Rate limited — backing off 10s');
          await sleep(10000);
          continue;
        }
        console.error(`[gmail-organizer] Error processing ${msgRef.id}:`, err.message);
        stats.errors++;
      }
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken && stats.processed < maxResults);

  return stats;
}

function classifyMessage(msg) {
  for (const rule of CATEGORIZATION_RULES) {
    if (rule.match(msg)) return rule.label;
  }
  return null;
}

let lastApiCall = 0;
async function rateLimitDelay() {
  const elapsed = Date.now() - lastApiCall;
  if (elapsed < 100) await sleep(100 - elapsed);
  lastApiCall = Date.now();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## Gmail Filters

### Step 7: Create Filters for Auto-Categorization

Set up filters so future mail is automatically labeled.

```javascript
const FILTER_RULES = [
  {
    criteria: { query: 'has:unsubscribe OR list:*' },
    action: { addLabelIds: ['Organize/Newsletters'], removeLabelIds: ['INBOX'] },
  },
  {
    criteria: { query: 'subject:(receipt OR invoice OR order confirmation OR payment)' },
    action: { addLabelIds: ['Organize/Receipts'] },
  },
  {
    criteria: { query: 'from:(*noreply* OR *no-reply* OR *notifications*)' },
    action: { addLabelIds: ['Organize/Notifications'] },
  },
];

async function createFilters(gmail, labelMap) {
  const created = [];

  for (const rule of FILTER_RULES) {
    const addLabelIds = (rule.action.addLabelIds || [])
      .map(name => labelMap[name])
      .filter(Boolean);
    const removeLabelIds = (rule.action.removeLabelIds || [])
      .map(name => labelMap[name] || name)
      .filter(Boolean);

    try {
      const result = await gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria: rule.criteria,
          action: { addLabelIds, removeLabelIds },
        },
      });
      created.push({ id: result.data.id, criteria: rule.criteria });
      logAction('filter_created', { id: result.data.id, criteria: rule.criteria });
    } catch (err) {
      console.error(`[gmail-organizer] Filter creation failed:`, err.message);
    }
  }

  return created;
}
```

## Draft Responses

### Step 8: Create Draft Responses for Flagged Messages

Create drafts for emails that need a response. Clearly marked as AI-generated.

```javascript
async function createDraftResponse(gmail, messageId, originalSubject, senderEmail) {
  const draftBody =
    `[AI-GENERATED DRAFT — Review and edit before sending]\n\n` +
    `Hi,\n\n` +
    `Thank you for your email regarding "${originalSubject}". ` +
    `I'm reviewing this and will get back to you shortly.\n\n` +
    `Best regards`;

  const raw = createRawEmail({
    to: senderEmail,
    subject: `Re: ${originalSubject}`,
    body: draftBody,
    inReplyTo: messageId,
  });

  // SAFETY: This creates a DRAFT only, never sends
  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw, threadId: messageId },
    },
  });

  logAction('draft_created', {
    draftId: draft.data.id,
    inReplyTo: messageId,
    subject: originalSubject.substring(0, 80),
    recipient: senderEmail,
    note: 'AI-GENERATED DRAFT — not sent',
  });

  return draft.data;
}

function createRawEmail({ to, subject, body, inReplyTo }) {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
    '',
    body,
  ].filter(Boolean).join('\r\n');

  return Buffer.from(message).toString('base64url');
}
```

## Audit Trail

### Step 9: Log Every Action for Reversibility

```javascript
const AUDIT_PATH = path.join(process.env.HOME, '.agents', 'data', 'gmail-audit-trail.json');

function logAction(type, details) {
  const audit = loadJSON(AUDIT_PATH) || { actions: [] };
  audit.actions.push({
    type,
    timestamp: new Date().toISOString(),
    details,
  });

  const tmp = `/tmp/gmail-audit-${Date.now()}.json`;
  fs.writeFileSync(tmp, JSON.stringify(audit, null, 2));
  fs.renameSync(tmp, AUDIT_PATH);
}
```

```bash
# Query the audit trail
jq '.actions | length' ~/.agents/data/gmail-audit-trail.json

# Show recent actions
jq '.actions[-10:]' ~/.agents/data/gmail-audit-trail.json

# Count actions by type
jq '[.actions[].type] | group_by(.) | map({type: .[0], count: length})' \
  ~/.agents/data/gmail-audit-trail.json
```

### Undo Operations

Reverse label assignments using the audit trail.

```javascript
async function undoLabelActions(gmail, sinceTimestamp) {
  const audit = loadJSON(AUDIT_PATH) || { actions: [] };
  const toUndo = audit.actions.filter(
    a => a.type === 'email_labeled' && a.timestamp >= sinceTimestamp
  );

  let undone = 0;
  for (const action of toUndo.reverse()) {
    try {
      const labelMap = await getLabelMap(gmail);
      const labelId = labelMap[action.details.label];
      if (!labelId) continue;

      await gmail.users.messages.modify({
        userId: 'me',
        id: action.details.messageId,
        requestBody: { removeLabelIds: [labelId] },
      });
      undone++;
    } catch (err) {
      console.error(`[gmail-organizer] Undo failed for ${action.details.messageId}:`, err.message);
    }
  }

  return { undone, total: toUndo.length };
}
```

## Summary Statistics

### Step 10: Generate Organization Report

```javascript
async function generateReport(gmail, stats) {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const labels = await gmail.users.labels.list({ userId: 'me' });
  const audit = loadJSON(AUDIT_PATH) || { actions: [] };

  const organizeLabels = labels.data.labels.filter(l => l.name.startsWith('Organize/'));

  const report = {
    account: profile.data.emailAddress,
    totalMessages: profile.data.messagesTotal,
    labelsCreated: organizeLabels.length,
    emailsProcessed: stats.processed,
    emailsLabeled: stats.labeled,
    emailsSkipped: stats.skipped,
    errors: stats.errors,
    draftsCreated: audit.actions.filter(a => a.type === 'draft_created').length,
    totalAuditActions: audit.actions.length,
    generatedAt: new Date().toISOString(),
    phase: 'Phase 1 — Organization (pre-Proton migration)',
  };

  return report;
}
```

```bash
# Quick stats from the audit trail
echo "=== Gmail Organizer Stats ==="
echo "Total actions: $(jq '.actions | length' ~/.agents/data/gmail-audit-trail.json)"
echo "Labels created: $(jq '[.actions[] | select(.type == "label_created")] | length' ~/.agents/data/gmail-audit-trail.json)"
echo "Emails labeled: $(jq '[.actions[] | select(.type == "email_labeled")] | length' ~/.agents/data/gmail-audit-trail.json)"
echo "Drafts created: $(jq '[.actions[] | select(.type == "draft_created")] | length' ~/.agents/data/gmail-audit-trail.json)"
```

## Full Orchestration

### Step 11: Run the Complete Organization Pipeline

```javascript
async function runOrganizer() {
  console.log('[gmail-organizer] Starting Gmail organization...');
  console.log('[gmail-organizer] SAFETY: Read-only + drafts. No sends. No permanent deletes.');

  const gmail = await getGmailClient();
  await verifyConnection(gmail);

  console.log('[gmail-organizer] Creating labels...');
  const createdLabels = await createLabels(gmail);

  const labelMap = await getLabelMap(gmail);

  console.log('[gmail-organizer] Creating filters...');
  const filters = await createFilters(gmail, labelMap);

  console.log('[gmail-organizer] Categorizing inbox (up to 500 messages)...');
  const stats = await categorizeInbox(gmail, labelMap, { maxResults: 500 });

  const report = await generateReport(gmail, stats);
  console.log('[gmail-organizer] Complete:', JSON.stringify(report, null, 2));

  return report;
}
```

## Tips

- Never request the `gmail.send` scope. If it is somehow granted, the skill must refuse to call `messages.send`. This is the single most important safety constraint.
- The audit trail is your undo button. Every label assignment, filter creation, and draft is logged with enough detail to reverse it. Check it before running a second pass.
- Rate limit to ~10 API calls per second. Gmail's quota is 250 units/second but individual calls cost 5-50 units. Conservative throttling avoids 429 errors.
- Use `format: 'metadata'` when fetching messages for classification. Full message bodies cost more quota and are not needed for header-based categorization.
- The label hierarchy uses `/` separators (`Organize/Work`). Gmail renders these as nested labels in the UI, which keeps the sidebar clean.
- Run categorization on inbox first (`in:inbox`), then expand to `in:anywhere` for deeper cleanup. Starting broad risks hitting rate limits before touching important recent mail.
- Draft responses are clearly marked with `[AI-GENERATED DRAFT]` at the top. This prevents accidental sends of unreviewed content.
- The `Migration/Export-Ready` label is for Phase 2 — tagging emails to export to Proton Mail. Do not use it yet; it is a placeholder for the migration step.
- Store the OAuth token at `~/.agents/config/gmail-token.json`, not in the data directory. Config files are credentials; data files are state.
- Test with a small batch first (`maxResults: 10`) to verify categorization accuracy before running on the full inbox.
