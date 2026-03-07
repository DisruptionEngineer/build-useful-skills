---
name: airgap-devops
description: Monitor and manage AirGap platform deployments across Vercel, Railway, and Formspree via Discord commands in #devops. Use when checking CI/CD status across all repos, triggering Railway or Vercel deployments, viewing deployment logs, rolling back a failed deploy, checking Formspree form submission stats, or getting a unified health overview of all AirGap services.
metadata: {"clawdbot":{"emoji":"🚀","requires":{"anyBins":["gh","jq","curl"]},"os":["linux","darwin","win32"]}}
---

# AirGap DevOps

The deployment command center for the AirGap platform. Listen on `#devops` for commands to monitor, deploy, and troubleshoot six microservices spanning Vercel (static/SSR), Railway (Python APIs), Formspree (forms), and self-hosted Docker (airgap-rx). Surface CI status from GitHub Actions, deployment health from Railway/Vercel APIs, and form submission stats from Formspree — all without leaving Discord.

## When to Use

- Checking CI pipeline status across all 6 AirGap repos
- Triggering a Railway or Vercel deployment from Discord
- Viewing recent deployment logs for a specific service
- Rolling back a failed Railway deployment
- Checking Formspree waitlist form submission count
- Getting a unified health dashboard of all services
- Investigating a failed GitHub Actions workflow run
- Redeploying after a hotfix push

## Prerequisites

### Channel Setup

Commands are issued in `#devops`. The bot needs `READ_MESSAGES` and `SEND_MESSAGES` in this channel.

### CLI Tools

```bash
# GitHub CLI (for CI status)
gh --version
# gh auth status (must be authenticated)

# Railway CLI (for deployments)
railway version
# railway login (must be authenticated)

# Vercel CLI (for deployments)
vercel --version
# vercel login (must be authenticated)
```

### Environment Variables

```bash
# GitHub — uses gh CLI auth (no extra token needed)
export RAILWAY_TOKEN="your-railway-api-token"
export VERCEL_TOKEN="your-vercel-api-token"
export FORMSPREE_DEPLOY_KEY="705b0c23837441ada22960d4dda60cfd"
```

### Data Files

- `~/.agents/data/airgap-deployments.json` — deployment history and service registry

```bash
if [ ! -f ~/.agents/data/airgap-deployments.json ]; then
  cat > ~/.agents/data/airgap-deployments.json << 'EOF'
{
  "services": {
    "airgap-landing": {
      "repo": "DisruptionEngineer/airgap-landing",
      "branch": "master",
      "platform": "vercel",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-compound-web": {
      "repo": "DisruptionEngineer/airgap-compound",
      "branch": "main",
      "platform": "vercel",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-compound-api": {
      "repo": "DisruptionEngineer/airgap-compound",
      "branch": "main",
      "platform": "railway",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-gate": {
      "repo": "DisruptionEngineer/airgap-gate",
      "branch": "main",
      "platform": "railway",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-bond": {
      "repo": "DisruptionEngineer/airgap-bond",
      "branch": "main",
      "platform": "railway",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-bond-rxnorm": {
      "repo": "DisruptionEngineer/airgap-bond-rxnorm",
      "branch": "master",
      "platform": "railway",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    },
    "airgap-rx": {
      "repo": "DisruptionEngineer/airgap-rx",
      "branch": "main",
      "platform": "docker",
      "url": null,
      "last_deploy": null,
      "status": "unknown"
    }
  },
  "deploy_history": []
}
EOF
fi
```

## Service Map

```
┌─────────────────────────────────────────────────────────┐
│                    AirGap Platform                       │
├──────────────────┬──────────┬──────────────────────────-─┤
│ Service          │ Platform │ Port / Notes               │
├──────────────────┼──────────┼──────────────────────────-─┤
│ airgap-landing   │ Vercel   │ Astro 5 static site        │
│ airgap-compound  │ Vercel   │ Next.js 16 web app         │
│ airgap-compound  │ Railway  │ Fastify API gateway         │
│ airgap-gate      │ Railway  │ FastAPI MCP :8000           │
│ airgap-bond      │ Railway  │ FastAPI MCP :8001           │
│ airgap-bond-rxnm │ Railway  │ FastAPI MCP :8002           │
│ airgap-rx        │ Docker   │ 24 microservices (self-host)│
└──────────────────┴──────────┴──────────────────────────-─┘
```

## Commands

### `!status` — Unified Health Dashboard

Check CI and deployment status across all services.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'devops') return;
  if (!isAuthorizedUser(message.author.id)) return;

  if (message.content.trim() === '!status') {
    const deployments = loadDeployments();
    let output = '**🚀 AirGap Platform Status**\n\n';

    for (const [name, svc] of Object.entries(deployments.services)) {
      // Fetch latest CI run from GitHub
      const ciStatus = await getCIStatus(svc.repo, svc.branch);
      const icon = ciStatus === 'success' ? '🟢' :
                   ciStatus === 'failure' ? '🔴' :
                   ciStatus === 'in_progress' ? '🟡' : '⚪';

      output += `${icon} **${name}** (${svc.platform})`;
      if (svc.url) output += ` — [live](${svc.url})`;
      output += `\n   CI: ${ciStatus}`;
      if (svc.last_deploy) output += ` | Deployed: ${svc.last_deploy.slice(0, 16)}`;
      output += '\n';
    }

    await message.channel.send(output);
  }
});
```

```bash
# Underlying GitHub CLI call for CI status
gh run list --repo DisruptionEngineer/airgap-gate --limit 1 \
  --json conclusion,status,displayTitle,createdAt \
  --jq '.[0] | "\(.status) \(.conclusion // "pending") \(.displayTitle)"'
```

### `!ci [repo]` — Detailed CI Status

Show recent CI runs for a specific repo or all repos.

```javascript
const ciMatch = message.content.match(/^!ci(?:\s+(\S+))?/i);
if (ciMatch) {
  const repoFilter = ciMatch[1]; // e.g., "gate", "bond", "landing"
  const deployments = loadDeployments();

  let repos = Object.entries(deployments.services);
  if (repoFilter) {
    repos = repos.filter(([name]) =>
      name.toLowerCase().includes(repoFilter.toLowerCase())
    );
  }

  let output = '**📋 CI Pipeline Status**\n\n';

  for (const [name, svc] of repos) {
    const runs = await getRecentRuns(svc.repo, 3);
    output += `**${name}** (\`${svc.repo}\`)\n`;
    for (const run of runs) {
      const icon = run.conclusion === 'success' ? '✅' :
                   run.conclusion === 'failure' ? '❌' : '⏳';
      output += `  ${icon} ${run.displayTitle} (${run.createdAt.slice(0, 10)})\n`;
    }
    output += '\n';
  }

  await message.channel.send(output);
}
```

```bash
# Fetch last 3 CI runs for a repo
gh run list --repo DisruptionEngineer/airgap-gate --limit 3 \
  --json conclusion,status,displayTitle,createdAt,headBranch
```

### `!deploy <service>` — Trigger Deployment

Deploy a specific service to its platform.

```javascript
const deployMatch = message.content.match(/^!deploy\s+(\S+)/i);
if (deployMatch) {
  const target = deployMatch[1].toLowerCase();
  const deployments = loadDeployments();
  const svc = findService(deployments, target);

  if (!svc) {
    await message.reply(
      `Unknown service \`${target}\`. Available: ${Object.keys(deployments.services).join(', ')}`
    );
    return;
  }

  await message.channel.send(`⏳ Deploying **${svc.name}** to ${svc.platform}...`);

  try {
    let result;
    switch (svc.platform) {
      case 'vercel':
        result = await deployVercel(svc);
        break;
      case 'railway':
        result = await deployRailway(svc);
        break;
      default:
        await message.reply(`Manual deploy required for ${svc.platform}.`);
        return;
    }

    const now = new Date().toISOString();
    svc.last_deploy = now;
    svc.status = 'deployed';
    saveDeployments(deployments);

    appendDeployHistory({
      service: svc.name, platform: svc.platform,
      triggered_by: message.author.username,
      deployed_at: now, status: 'success', url: result.url
    });

    await message.channel.send(
      `✅ **${svc.name}** deployed to ${svc.platform}!\n` +
      (result.url ? `🔗 ${result.url}\n` : '') +
      `Deployed at: ${now.slice(0, 16)}`
    );
  } catch (err) {
    await message.channel.send(`❌ Deploy failed: ${err.message}`);
  }
}
```

```bash
# Vercel deployment (triggered via Vercel CLI)
cd ~/Code/airgap-repos/airgap-landing
vercel --prod --yes --token "$VERCEL_TOKEN"

# Railway deployment (triggered via Railway CLI)
cd ~/Code/airgap-repos/airgap-gate
railway up --detach
```

### `!logs <service> [lines]` — View Recent Logs

```javascript
const logsMatch = message.content.match(/^!logs\s+(\S+)(?:\s+(\d+))?/i);
if (logsMatch) {
  const [, target, lineCount] = logsMatch;
  const lines = parseInt(lineCount) || 20;
  const svc = findService(loadDeployments(), target);

  if (svc.platform === 'railway') {
    const logs = await getRailwayLogs(svc, lines);
    await message.channel.send(
      `**📜 Logs — ${svc.name} (last ${lines} lines)**\n\`\`\`\n${logs}\n\`\`\``
    );
  } else if (svc.platform === 'vercel') {
    await message.channel.send(
      `Vercel logs: \`vercel logs ${svc.url} --token $VERCEL_TOKEN\``
    );
  } else {
    await message.reply(`Logs not available for ${svc.platform} platform.`);
  }
}
```

```bash
# Railway logs
railway logs --lines 20

# Vercel function logs
vercel logs https://your-app.vercel.app --token "$VERCEL_TOKEN"
```

### `!rollback <service>` — Rollback Last Deployment

```javascript
const rollbackMatch = message.content.match(/^!rollback\s+(\S+)/i);
if (rollbackMatch) {
  const target = rollbackMatch[1];
  const svc = findService(loadDeployments(), target);

  await message.channel.send(`⏪ Rolling back **${svc.name}**...`);

  if (svc.platform === 'railway') {
    // Railway rollback via CLI
    const result = await execAsync(`railway rollback`);
    await message.channel.send(`✅ **${svc.name}** rolled back.\n${result}`);
  } else if (svc.platform === 'vercel') {
    await message.channel.send(
      `Vercel rollback: use the Vercel dashboard or \`vercel rollback --token $VERCEL_TOKEN\``
    );
  }
}
```

### `!forms` — Formspree Submission Stats

```javascript
if (message.content.trim() === '!forms') {
  const result = await execAsync(
    `FORMSPREE_DEPLOY_KEY=${process.env.FORMSPREE_DEPLOY_KEY} ` +
    `NOTIFICATION_EMAIL=${process.env.NOTIFICATION_EMAIL} ` +
    `formspree deploy 2>&1`
  );

  await message.channel.send(
    '**📋 Formspree — Airgap Gate Waitlist**\n' +
    `Project ID: \`2946863781906481136\`\n` +
    `Endpoint: \`https://formspree.io/p/2946863781906481136/f/waitlist\`\n` +
    `Deploy status: ${result.includes('succeeded') ? '✅ Active' : '⚠️ Check config'}\n\n` +
    `View submissions: https://formspree.io/forms`
  );
}
```

```bash
# Verify Formspree form is active
FORMSPREE_DEPLOY_KEY=705b0c23837441ada22960d4dda60cfd \
NOTIFICATION_EMAIL=disruptionengineer@gmail.com \
formspree deploy

# Test form endpoint
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://formspree.io/p/2946863781906481136/f/waitlist" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"email":"health-check@test.com"}'
# Expected: 200
```

### `!redeploy <service>` — Force Redeploy (No Code Change)

```bash
# Railway: redeploy latest
railway redeploy --yes

# Vercel: redeploy latest
vercel --prod --yes --force --token "$VERCEL_TOKEN"
```

### `!env <service> [key]` — List Environment Variables

```javascript
const envMatch = message.content.match(/^!env\s+(\S+)(?:\s+(\S+))?/i);
if (envMatch) {
  const [, target, key] = envMatch;
  const svc = findService(loadDeployments(), target);

  if (svc.platform === 'railway') {
    if (key) {
      const val = await execAsync(`railway variables get ${key}`);
      await message.channel.send(`\`${key}\` = \`${val.trim()}\``);
    } else {
      const vars = await execAsync(`railway variables`);
      // Mask values for security
      const masked = vars.replace(/=.+/g, '=****');
      await message.channel.send(`**🔐 Env — ${svc.name}**\n\`\`\`\n${masked}\n\`\`\``);
    }
  }
}
```

## Helper Functions

### Load and Save Deployments

```javascript
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(process.env.HOME, '.agents', 'data', 'airgap-deployments.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function loadDeployments() {
  return loadJSON(DATA_FILE) || { services: {}, deploy_history: [] };
}

function saveDeployments(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function appendDeployHistory(entry) {
  const data = loadDeployments();
  data.deploy_history.push(entry);
  saveDeployments(data);
}
```

### Find Service by Fuzzy Name

```javascript
function findService(deployments, target) {
  const normalized = target.toLowerCase().replace(/[-_]/g, '');
  for (const [name, svc] of Object.entries(deployments.services)) {
    if (name.toLowerCase().replace(/[-_]/g, '').includes(normalized)) {
      return { name, ...svc };
    }
  }
  return null;
}
```

### Get CI Status via GitHub CLI

```javascript
const { execSync } = require('child_process');

async function getCIStatus(repo, branch) {
  try {
    const result = execSync(
      `gh run list --repo ${repo} --limit 1 --branch ${branch} ` +
      `--json conclusion,status --jq '.[0]'`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const run = JSON.parse(result);
    return run.conclusion || run.status;
  } catch {
    return 'unknown';
  }
}

async function getRecentRuns(repo, limit = 3) {
  const result = execSync(
    `gh run list --repo ${repo} --limit ${limit} ` +
    `--json conclusion,status,displayTitle,createdAt,headBranch`,
    { encoding: 'utf8', timeout: 10000 }
  );
  return JSON.parse(result);
}
```

## Deployment History Schema

```json
{
  "deploy_history": [
    {
      "service": "airgap-gate",
      "platform": "railway",
      "triggered_by": "disruptionengineer",
      "deployed_at": "2026-02-28T03:00:00.000Z",
      "status": "success",
      "url": "https://airgap-gate.up.railway.app"
    }
  ]
}
```

## Tips

- `!status` is the daily driver. Run it every morning to catch overnight CI failures before they stack up.
- Service names are fuzzy-matched — `!deploy gate` works the same as `!deploy airgap-gate`.
- Always check `!ci` before `!deploy`. Deploying with failing tests defeats the purpose of CI.
- Railway environment variables are masked in `!env` output. Never post raw secrets to Discord.
- airgap-rx is docker/self-hosted — it shows in `!status` for awareness but deploy/rollback are manual.
- The Formspree form endpoint uses the CLI project format: `/p/{project_id}/f/{form_key}`. Standard `/f/{hashid}` won't work.
- Deploy history is append-only and tracks who triggered each deploy — useful for audit.
- `!logs` defaults to 20 lines. Pass a number for more: `!logs gate 50`.
- If a Railway deploy fails, check `!logs` first — the error is usually a missing env var or port binding.
- Vercel deploys are triggered by git push. Use `!deploy` only when you need a manual prod deployment.
