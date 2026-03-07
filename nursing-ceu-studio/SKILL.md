---
name: nursing-ceu-studio
description: Research, outline, and produce nursing Continuing Education Unit (CEU) content via Discord channels with Google Drive artifact staging and PowerPoint slide deck creation. Use when Rachel posts a new CEU topic for initial research and outline generation, reviewing or refining a CEU syllabus via Discord reactions, uploading approved artifacts to Google Drive for Google NotebookLM ingestion, creating a new PowerPoint slide deck from CEU content using Claude's PowerPoint integration, uploading an existing PowerPoint for visual cleanup and text consistency, or tracking CEU project status across the pipeline. Organized under a Nursing Education Discord category with four channels: #ceu-topics, #ceu-artifacts, #ceu-slides, #slide-cleanup.
metadata: {"clawdbot":{"emoji":"🩺","requires":{"anyBins":["jq","curl"]},"os":["linux","darwin"]}}
---

# Nursing CEU Studio

Support Rachel's nursing education workflow end to end via Discord. She posts a CEU topic in `#ceu-topics` and the agent performs initial research — pulling evidence-based nursing content, regulatory requirements, and best-practice guidelines — then generates a structured outline, learning objectives, and a draft syllabus. Rachel approves, refines, or requests a new search via emoji reactions. Approved artifacts are uploaded to Google Drive and posted in `#ceu-artifacts` with shareable links ready for Google NotebookLM ingestion. From approved content, `#ceu-slides` creates a professional PowerPoint deck using the Claude PowerPoint add-in or the SlideSpeak MCP. A separate `#slide-cleanup` channel accepts uploaded `.pptx` files and returns them with consistent formatting, visual polish, and text normalization.

## When to Use

- Rachel posts a new CEU topic in `#ceu-topics` for research and outline generation
- Reviewing a generated CEU outline and refining it via reactions and notes
- Uploading approved outlines, syllabi, and reference lists to Google Drive
- Staging artifacts for Google NotebookLM ingestion via `#ceu-artifacts`
- Creating a new PowerPoint slide deck from approved CEU content
- Uploading an existing `.pptx` file to `#slide-cleanup` for visual normalization
- Checking CEU project status or viewing the full pipeline backlog

## Prerequisites

### Shared Bot

This skill uses the OpenClaw Discord bot — no separate bot configuration needed.

### Channel Permissions

The bot needs `SEND_MESSAGES`, `ADD_REACTIONS`, `READ_MESSAGE_HISTORY`, and `ATTACH_FILES` in:
- `#ceu-topics` (research results, outlines, reaction controls)
- `#ceu-artifacts` (Google Drive links, artifact summaries)
- `#ceu-slides` (slide deck creation status, download links)
- `#slide-cleanup` (upload processing, before/after summaries)

### Discord Server Setup

Create a **Nursing Education** category with four text channels:

```bash
# Using discord-server-manager skill:
# !create-category Nursing Education
# !create-channel ceu-topics in "Nursing Education"
# !create-channel ceu-artifacts in "Nursing Education"
# !create-channel ceu-slides in "Nursing Education"
# !create-channel slide-cleanup in "Nursing Education"
```

### Environment Variables

```bash
# Google Drive — Application Default Credentials (user-level OAuth)
# Files upload as your Google account, counting against personal 15GB quota.
# Refresh if expired: gcloud auth application-default login \
#   --scopes="https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/cloud-platform"
GOOGLE_DRIVE_AUTH_MODE="adc"
GOOGLE_DRIVE_FOLDER_ID="1bTiOrC17NUzsPGmqi6HkouuoBNzEfsKW"

# Service account (for non-storage API calls like folder listing)
GOOGLE_DRIVE_SERVICE_ACCOUNT="~/.agents/config/google-drive-credentials.json"

# SlideSpeak MCP (optional — for slide generation outside PowerPoint)
SLIDESPEAK_API_KEY="your-slidespeak-api-key"
```

Store in `~/.agents/config/ceu-studio.env` or export in the bot environment.

### Data Directory

```bash
mkdir -p ~/.agents/data

if [ ! -f ~/.agents/data/ceu-projects.json ]; then
  echo '{"projects": []}' > ~/.agents/data/ceu-projects.json
fi
```

### Authorized Users

```json
// ~/.agents/config/authorized-users.json — Rachel must be listed
{
  "authorized_users": [
    { "discord_id": "1439787060763426926", "name": "disruptionengineer" },
    { "discord_id": "RACHEL_DISCORD_ID", "name": "rachel" }
  ]
}
```

## Data Schema

### ceu-projects.json

```json
{
  "projects": [
    {
      "id": "CEU-0001",
      "timestamp": "2026-02-28T14:00:00.000Z",
      "author": "rachel",
      "author_discord_id": "RACHEL_DISCORD_ID",
      "topic": "Trauma-Informed Care in Pediatric Settings",
      "raw_text": "I need a 2-hour CEU on trauma-informed care for pediatric nurses",
      "status": "new",
      "target_hours": 2,
      "audience": "RNs, pediatric",
      "research": null,
      "outline": null,
      "syllabus": null,
      "learning_objectives": null,
      "drive_folder_url": null,
      "drive_file_ids": [],
      "slide_deck_url": null,
      "notes": [],
      "channel_message_id": "1234567890123456789"
    }
  ]
}
```

### Status Values

| Status | Meaning | Channel |
|--------|---------|---------|
| `new` | Topic captured, awaiting research | `#ceu-topics` |
| `researched` | Research complete, outline posted | `#ceu-topics` |
| `approved` | Outline approved by Rachel | `#ceu-topics` |
| `artifacts_staged` | Artifacts uploaded to Google Drive | `#ceu-artifacts` |
| `slides_created` | PowerPoint deck generated | `#ceu-slides` |
| `complete` | All deliverables finalized | — |
| `revision` | Sent back for changes | `#ceu-topics` |

## Channel 1: #ceu-topics — Research and Outline

### Step 1: Listen for New Topics

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'ceu-topics') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;
  if (message.content.startsWith('[SYSTEM]')) return;

  await processNewTopic(message);
});
```

### Step 2: Parse Topic and CEU Parameters

Extract the topic, target contact hours, and audience from the message.

```javascript
function parseCeuRequest(text) {
  const raw = text.trim();

  // Detect target hours (e.g., "2-hour CEU", "1.5 contact hours")
  const hoursMatch = raw.match(/(\d+\.?\d*)\s*[-–]?\s*(?:hour|hr|contact hour)/i);
  const target_hours = hoursMatch ? parseFloat(hoursMatch[1]) : 1;

  // Detect audience keywords
  const audienceKeywords = {
    'RN': /\bRNs?\b/i, 'LPN': /\bLPNs?\b/i, 'NP': /\bNPs?\b/i,
    'APRN': /\bAPRNs?\b/i, 'CNA': /\bCNAs?\b/i,
    'pediatric': /pediatric/i, 'geriatric': /geriatric/i,
    'oncology': /oncolog/i, 'ICU': /\bICU\b/i, 'ED': /\b(ED|emergency)\b/i,
    'psych': /psych|mental\s*health/i, 'community': /community|public\s*health/i
  };
  const audience = Object.entries(audienceKeywords)
    .filter(([, re]) => re.test(raw))
    .map(([label]) => label);

  // The topic is the full text minus parameter fragments
  const topic = raw
    .replace(/(\d+\.?\d*)\s*[-–]?\s*(?:hour|hr|contact hour)\s*CEU/i, '')
    .replace(/\bfor\s+(RNs?|LPNs?|NPs?|APRNs?|CNAs?)\b/gi, '')
    .replace(/\bI need\b/i, '')
    .replace(/\ba?\s*CEU\s*on\b/i, '')
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, '');

  return {
    topic: topic || raw,
    target_hours,
    audience: audience.length ? audience : ['RN']
  };
}
```

### Step 3: Perform Initial Research

Use web search and LLM to gather evidence-based content for the CEU topic.

```javascript
async function researchTopic(topic, audience, targetHours) {
  const searchQueries = [
    `${topic} evidence-based nursing practice guidelines`,
    `${topic} continuing education nursing objectives`,
    `${topic} ANCC accreditation criteria`,
    `${topic} nursing competency assessment`
  ];

  const results = [];
  for (const query of searchQueries) {
    const searchResults = await webSearch(query);
    results.push(...searchResults.slice(0, 3));
  }

  // Deduplicate by URL
  const unique = [...new Map(results.map(r => [r.url, r])).values()];

  return {
    sources: unique,
    searched_at: new Date().toISOString(),
    query_count: searchQueries.length
  };
}
```

### Step 4: Generate Outline and Learning Objectives

```javascript
async function generateOutline(topic, research, audience, targetHours) {
  const prompt = `You are a nursing education curriculum designer. Generate a CEU outline.

Topic: ${topic}
Target Contact Hours: ${targetHours}
Target Audience: ${audience.join(', ')}
Research Sources: ${research.sources.map(s => s.title).join('; ')}

Generate:
1. **Learning Objectives** (3-5 measurable objectives using Bloom's taxonomy verbs)
2. **Content Outline** (organized by modules, timed to fill ${targetHours} contact hours)
3. **Teaching Strategies** (lecture, case study, simulation, group discussion, etc.)
4. **Assessment Methods** (post-test questions, return demonstration, reflection)
5. **Key References** (APA format, evidence-based sources)

Format the outline with clear headings and time allocations per module.
Each module should note which learning objective(s) it addresses.`;

  return await llm.complete(prompt);
}
```

### Step 5: Generate Draft Syllabus

```javascript
async function generateSyllabus(topic, outline, audience, targetHours) {
  const prompt = `You are a nursing education curriculum designer. Generate a formal CEU syllabus.

Topic: ${topic} | Hours: ${targetHours} | Audience: ${audience.join(', ')}
Outline: ${outline}

Include all ANCC-required sections: program title/description, audience/prerequisites,
learning objectives (numbered), content outline with time allocations (table),
teaching methods, evaluation methods (post-test passing score), accreditation
statement placeholder, conflict of interest disclosure template, references (APA 7th),
and faculty qualifications template. Use formal academic language.`;

  return await llm.complete(prompt);
}
```

### Step 6: Post Research Results to #ceu-topics

```javascript
async function postResearchCard(channel, project, outline) {
  const embed = {
    title: `CEU Research — ${project.id}`,
    description: `**Topic:** ${project.topic}\n**Hours:** ${project.target_hours}\n**Audience:** ${project.audience.join(', ')}`,
    fields: [
      { name: 'Learning Objectives', value: extractObjectives(outline), inline: false },
      { name: 'Module Count', value: `${countModules(outline)} modules`, inline: true },
      { name: 'Sources Found', value: `${project.research.sources.length} references`, inline: true },
      { name: 'Status', value: 'Awaiting review', inline: true }
    ],
    footer: { text: '✅ Approve  ✏️ Revise  📝 Notes  📄 View Full Outline' },
    color: 0x2E86AB,
    timestamp: new Date().toISOString()
  };

  const msg = await channel.send({ embeds: [embed] });
  for (const emoji of ['✅', '✏️', '📝', '📄']) {
    await msg.react(emoji);
  }

  // Post the full outline as a follow-up (collapsed in a code block for readability)
  await channel.send(`**Full Outline — ${project.id}**\n\`\`\`\n${outline.substring(0, 1900)}\n\`\`\``);

  return msg.id;
}
```

### Reaction Controls for #ceu-topics

| Reaction | Action |
|----------|--------|
| ✅ | Approve outline — moves to `approved`, triggers artifact staging |
| ✏️ | Request revision — bot asks for specific feedback (60s timeout) |
| 📝 | Add notes — bot asks for text to append to the project notes |
| 📄 | View full outline — bot DMs the complete outline + syllabus |

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.message.channel.name !== 'ceu-topics') return;
  if (user.bot || !isAuthorizedUser(user.id)) return;

  const projectId = extractProjectIdFromEmbed(reaction.message);
  if (!projectId) return;

  switch (reaction.emoji.name) {
    case '✅':
      await approveOutline(projectId, reaction.message.channel);
      break;
    case '✏️':
      await requestRevision(projectId, reaction.message.channel, user);
      break;
    case '📝':
      await addNote(projectId, reaction.message.channel, user);
      break;
    case '📄':
      await sendFullOutline(projectId, user);
      break;
  }
});
```

## Channel 2: #ceu-artifacts — Google Drive Staging

When an outline is approved, upload all artifacts to Google Drive and post links in `#ceu-artifacts`.

### Step 1: Create Project Folder in Google Drive

```javascript
const { google } = require('googleapis');

async function createDriveFolder(projectId, topic) {
  const auth = await getGoogleAuth(); // Uses ADC — uploads as your Google account
  const drive = google.drive({ version: 'v3', auth });

  const folderName = `${projectId} — ${topic}`;
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
    },
    fields: 'id, webViewLink'
  });

  return { folderId: folder.data.id, folderUrl: folder.data.webViewLink };
}
```

### Step 2: Upload Artifacts as Google Docs

Upload the outline, syllabus, and reference list as separate Google Docs for easy NotebookLM import.

```javascript
async function uploadArtifact(auth, folderId, name, content) {
  const drive = google.drive({ version: 'v3', auth });

  const file = await drive.files.create({
    requestBody: {
      name: name,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId]
    },
    media: {
      mimeType: 'text/plain',
      body: content
    },
    fields: 'id, webViewLink'
  });

  return { fileId: file.data.id, fileUrl: file.data.webViewLink };
}

async function stageArtifacts(project) {
  const auth = await getGoogleAuth();
  const { folderId, folderUrl } = await createDriveFolder(project.id, project.topic);

  const artifacts = [
    { name: `${project.id} — Outline`, content: project.outline },
    { name: `${project.id} — Syllabus`, content: project.syllabus },
    { name: `${project.id} — Learning Objectives`, content: project.learning_objectives },
    { name: `${project.id} — References`, content: extractReferences(project.research) }
  ];

  const uploaded = [];
  for (const artifact of artifacts) {
    const result = await uploadArtifact(auth, folderId, artifact.name, artifact.content);
    uploaded.push({ ...artifact, ...result });
  }

  return { folderId, folderUrl, files: uploaded };
}
```

### Step 3: Post Links to #ceu-artifacts

```javascript
async function postArtifactLinks(channel, project, driveResult) {
  const fileList = driveResult.files
    .map(f => `- [${f.name}](${f.fileUrl})`)
    .join('\n');

  const embed = {
    title: `Google Drive Artifacts — ${project.id}`,
    description: `**Topic:** ${project.topic}\n**Folder:** [Open in Drive](${driveResult.folderUrl})`,
    fields: [
      { name: 'Uploaded Files', value: fileList, inline: false },
      { name: 'NotebookLM Ready', value: 'Open the folder link above in Google NotebookLM to create a notebook from these sources.', inline: false }
    ],
    footer: { text: '📊 Request Slides  ✅ Mark Complete' },
    color: 0x34A853,
    timestamp: new Date().toISOString()
  };

  const msg = await channel.send({ embeds: [embed] });
  await msg.react('📊');
  await msg.react('✅');
}
```

| Reaction | Action |
|----------|--------|
| 📊 | Trigger slide deck creation in `#ceu-slides` |
| ✅ | Mark project complete (no slides needed) |

## Channel 3: #ceu-slides — PowerPoint Deck Creation

### Option A: Claude PowerPoint Add-In (Recommended)

The official Claude in PowerPoint add-in reads slide masters, layouts, fonts, and color schemes from an existing template and generates native PowerPoint objects.

```javascript
async function requestSlideDeck(channel, project) {
  // Generate a slide-creation prompt optimized for Claude PowerPoint
  const slidePrompt = buildSlidePrompt(project);

  await channel.send(
    `**Slide Deck Request — ${project.id}**\n` +
    `**Topic:** ${project.topic}\n` +
    `**Contact Hours:** ${project.target_hours}\n\n` +
    `**Instructions for Claude PowerPoint:**\n` +
    `Open PowerPoint with your university template, then paste this prompt ` +
    `into the Claude add-in:\n\n` +
    `\`\`\`\n${slidePrompt.substring(0, 1800)}\n\`\`\``
  );
}

function buildSlidePrompt(project) {
  return `Create a CEU presentation slide deck for nursing continuing education.

Topic: ${project.topic}
Contact Hours: ${project.target_hours}
Audience: ${project.audience.join(', ')}

Structure:
1. Title slide with program title, presenter name (leave as placeholder), date, contact hours, accreditation statement placeholder
2. Disclosure slide (conflict of interest, no relevant financial relationships template)
3. Learning Objectives slide (numbered list from outline)
4. Content slides following this outline:
${project.outline}
5. Case Study slides (1-2 clinical scenarios with discussion prompts)
6. Key Takeaways / Summary slide
7. Post-Test Information slide (how to access the post-test)
8. References slide(s) (APA 7th edition)
9. Q&A / Contact Information slide

Design guidance:
- Use the loaded template's color scheme and fonts
- One key concept per slide — avoid text-heavy slides
- Use diagrams and process flows where appropriate
- Include speaker notes with talking points for each content slide
- Add relevant clinical images or icons as placeholders
- Keep bullet points to 4-5 per slide maximum`;
}
```

### Option B: SlideSpeak MCP (Automated)

For fully automated deck generation without opening PowerPoint.

```javascript
async function createSlidesMcp(project) {
  const result = await mcpCall('slidespeak', 'create_presentation', {
    title: project.topic,
    slides: buildSlideArray(project),  // title, disclosure, objectives, modules, refs, Q&A
    theme: 'professional-medical',
    speakerNotes: true
  });
  return result.downloadUrl;
}
```

### Post Slide Deck to #ceu-slides

```javascript
async function postSlideDeck(channel, project, deckUrl) {
  const embed = {
    title: `Slide Deck Created — ${project.id}`,
    description: `**Topic:** ${project.topic}`,
    fields: [
      { name: 'Download', value: `[Download .pptx](${deckUrl})`, inline: true },
      { name: 'Slide Count', value: `${project.slideCount} slides`, inline: true },
      { name: 'Next Steps', value: 'Review in PowerPoint. Use the Claude add-in to refine individual slides.', inline: false }
    ],
    color: 0xD35230,
    timestamp: new Date().toISOString()
  };

  await channel.send({ embeds: [embed] });
  updateProjectStatus(project.id, 'slides_created');
}
```

## Channel 4: #slide-cleanup — Upload and Polish Existing Decks

A standalone entry point for cleaning up any `.pptx` file — not limited to CEU content.

### Step 1: Detect Uploaded Files

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'slide-cleanup') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  const pptxAttachment = message.attachments.find(
    a => a.name.endsWith('.pptx') || a.name.endsWith('.ppt')
  );

  if (!pptxAttachment) {
    await message.reply(
      'Upload a `.pptx` file and I will clean it up. ' +
      'Optionally add instructions like "make fonts consistent" or "fix bullet alignment".'
    );
    return;
  }

  await processSlideCleanup(message, pptxAttachment);
});
```

### Step 2: Download and Analyze the Deck

```bash
# Download the uploaded .pptx
curl -sL -o /tmp/cleanup-input.pptx "$ATTACHMENT_URL"

# Extract slide count and text content using python-pptx
python3 -c "
from pptx import Presentation
prs = Presentation('/tmp/cleanup-input.pptx')
for i, slide in enumerate(prs.slides):
    texts = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            texts.append(shape.text_frame.text)
    print(f'Slide {i+1}: {\" | \".join(texts[:3])}')
print(f'Total: {len(prs.slides)} slides')
"
```

### Step 3: Generate Cleanup Instructions

```javascript
async function analyzeAndCleanup(deckPath, userInstructions) {
  const prompt = `Analyze this PowerPoint deck and generate cleanup instructions.
User's direction: ${userInstructions || 'General cleanup'}

Apply nursing education presentation standards:
- Font consistency (one heading font, one body font)
- Bullet formatting (consistent style, indentation, spacing)
- Color scheme consistency across all slides
- Text sizing (titles 28-36pt, body 18-24pt, min 16pt)
- Slide layout alignment and margins
- Speaker notes presence and formatting
- References in APA 7th edition
- Spelling, grammar, and slide numbering

Return a structured list of changes to make.`;

  return await llm.complete(prompt);
}
```

### Step 4: Post Cleanup Summary

```javascript
async function postCleanupSummary(channel, message, analysis) {
  const embed = {
    title: 'Slide Cleanup Analysis',
    description: `**File:** ${message.attachments.first().name}`,
    fields: [
      { name: 'Issues Found', value: analysis.issueCount + ' items', inline: true },
      { name: 'Slides Affected', value: analysis.slidesAffected + ' slides', inline: true },
      { name: 'Changes Summary', value: analysis.summary.substring(0, 1000), inline: false }
    ],
    footer: { text: '✅ Apply Changes  📋 View Details  ❌ Cancel' },
    color: 0xF18F01,
    timestamp: new Date().toISOString()
  };

  const msg = await channel.send({ embeds: [embed] });
  for (const emoji of ['✅', '📋', '❌']) {
    await msg.react(emoji);
  }
}
```

### Step 5: Apply Changes via Claude PowerPoint

```javascript
// Generate a per-slide cleanup prompt for the Claude PowerPoint add-in
function buildCleanupPrompt(analysis) {
  return `Clean up this presentation with the following changes:

${analysis.changes.map((c, i) => `${i + 1}. Slide ${c.slide}: ${c.instruction}`).join('\n')}

Global changes:
- Normalize all body text to the same font and size
- Ensure consistent bullet formatting throughout
- Fix any misaligned text boxes
- Apply consistent slide transitions (subtle, not distracting)
- Verify all speaker notes are present and properly formatted`;
}
```

## Project Lifecycle Helpers

### Update Project Status

```bash
# Move project to a new status
jq --arg id "$PROJECT_ID" \
   --arg status "$NEW_STATUS" \
   '(.projects[] | select(.id == $id)).status = $status' \
   ~/.agents/data/ceu-projects.json > /tmp/ceu-tmp.json \
   && mv /tmp/ceu-tmp.json ~/.agents/data/ceu-projects.json
```

### Query Projects

```bash
# List active projects
jq '.projects[] | select(.status != "complete") | {id, topic, status}' \
  ~/.agents/data/ceu-projects.json

# Find project by ID
jq '.projects[] | select(.id == "CEU-0003")' \
  ~/.agents/data/ceu-projects.json

# Count by status
jq '[.projects[].status] | group_by(.) | map({status: .[0], count: length})' \
  ~/.agents/data/ceu-projects.json
```

### Generate Unique ID

```javascript
function generateProjectId(projects) {
  if (projects.length === 0) return 'CEU-0001';
  const lastId = projects[projects.length - 1].id;
  const num = parseInt(lastId.split('-')[1], 10) + 1;
  return `CEU-${String(num).padStart(4, '0')}`;
}
```

## Google Auth Helper

```javascript
const { google } = require('googleapis');

async function getGoogleAuth() {
  // Use Application Default Credentials (user-level OAuth via gcloud ADC)
  // Files upload as the authenticated user, not a service account
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return auth;
}
```

## Tips

- Rachel's CEU topics often arrive as casual messages like "I need something on sepsis recognition for ED nurses." The parser should handle informal phrasing gracefully.
- Learning objectives must use measurable Bloom's taxonomy verbs (identify, demonstrate, evaluate, analyze) — not vague verbs like "understand" or "know." The LLM prompt enforces this.
- ANCC accreditation requires specific syllabus sections. The syllabus generator includes all required fields with placeholder text for items Rachel fills in (faculty qualifications, accreditation statement).
- Google NotebookLM works best with Google Docs as source material. Upload artifacts as Docs, not PDFs — NotebookLM can parse and index Docs natively.
- The Claude PowerPoint add-in reads the slide master from Rachel's university template. Always open the template `.potx` first, then invoke Claude — this ensures brand-compliant output.
- For `#slide-cleanup`, the python-pptx library handles analysis. For applying changes, the Claude PowerPoint add-in is more reliable than programmatic edits because it understands visual layout intent.
- Keep slide text concise: one concept per slide, max 4-5 bullets. Nursing educators often overload slides with text. The cleanup analyzer flags text-heavy slides.
- Contact hour calculations: 50 minutes of instruction = 1 contact hour. A 2-hour CEU should have approximately 100 minutes of instructional content in the outline.
- Post-test questions should map directly to learning objectives. Each objective needs at least one corresponding test question.
- Reference slides must use APA 7th edition. The research step captures source metadata specifically so references can be auto-formatted correctly.
