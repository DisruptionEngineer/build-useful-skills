---
name: osint-recon
description: Perform open-source intelligence reconnaissance using Kali Linux tools and free online APIs. Use when conducting domain recon, email harvesting, username hunting across platforms, IP geolocation, WHOIS lookups, social media footprinting, public records searches, or exporting structured OSINT reports. Supports theHarvester, Sherlock, Shodan, WHOIS, and free web APIs.
metadata: {"clawdbot":{"emoji":"🔍","requires":{"anyBins":["theHarvester","sherlock","whois","nmap","curl"]},"os":["linux","darwin"]}}
---

# OSINT Recon

Perform open-source intelligence gathering using a combination of Kali Linux tools and free online APIs. Run interactive searches across domains, emails, usernames, IPs, and social media profiles. Structure results into exportable JSON reports. All searches use publicly available information only — no credential stuffing, no unauthorized access, no password cracking.

## When to Use

- Performing domain reconnaissance (subdomains, DNS records, WHOIS, certificates)
- Harvesting email addresses associated with a target domain
- Hunting usernames across social media and web platforms
- Looking up IP addresses for geolocation and hosting provider info
- Footprinting social media profiles from a name or handle
- Searching public records and data breach databases (ethical, legal sources only)
- Exporting structured OSINT findings as JSON or Markdown reports
- Building a reconnaissance profile before a penetration test engagement

## Prerequisites

### Kali Linux Tools

Install the core OSINT toolset. On Kali Linux these are pre-installed; on macOS/Ubuntu install manually.

```bash
# Kali Linux (pre-installed)
which theHarvester sherlock whois nmap dig

# macOS via Homebrew
brew install whois nmap
pip3 install theHarvester
pip3 install sherlock-project

# Ubuntu/Debian
sudo apt install whois nmap dnsutils
pip3 install theHarvester sherlock-project
```

### Free API Keys (Optional but Recommended)

Some tools work better with API keys. All are free-tier.

```bash
mkdir -p ~/.agents/config

# Store API keys for enhanced results
cat > ~/.agents/config/osint-api-keys.json << 'EOF'
{
  "shodan": "",
  "hunter_io": "",
  "virustotal": "",
  "ipinfo": "",
  "have_i_been_pwned": ""
}
EOF

# Get free API keys:
# Shodan: https://account.shodan.io/register (free tier: 100 queries/month)
# Hunter.io: https://hunter.io/users/sign_up (free: 25 searches/month)
# VirusTotal: https://www.virustotal.com/gui/join-us (free: 500 lookups/day)
# IPInfo: https://ipinfo.io/signup (free: 50k lookups/month)
```

### Data Directory

```bash
mkdir -p ~/.agents/data/osint-reports

# Initialize the report index
if [ ! -f ~/.agents/data/osint-report-index.json ]; then
  echo '{"reports": []}' > ~/.agents/data/osint-report-index.json
fi
```

## Domain Reconnaissance

### Step 1: WHOIS Lookup

Query domain registration information.

```bash
# Basic WHOIS query
whois example.com

# Extract key fields only
whois example.com | grep -iE 'registrant|admin|name server|creation|expir|updated'
```

```javascript
const { execSync } = require('child_process');
const fs = require('fs');

function whoisLookup(domain) {
  try {
    const raw = execSync(`whois ${sanitizeDomain(domain)}`, {
      encoding: 'utf8',
      timeout: 15000,
    });

    return {
      domain,
      raw,
      registrar: extractField(raw, /Registrar:\s*(.+)/i),
      creationDate: extractField(raw, /Creation Date:\s*(.+)/i),
      expiryDate: extractField(raw, /Expir.*Date:\s*(.+)/i),
      nameServers: raw.match(/Name Server:\s*(.+)/gi)?.map(l => l.split(':')[1].trim()) || [],
      registrant: extractField(raw, /Registrant.*Name:\s*(.+)/i),
      registrantOrg: extractField(raw, /Registrant.*Org.*:\s*(.+)/i),
    };
  } catch (err) {
    return { domain, error: err.message };
  }
}

function extractField(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function sanitizeDomain(domain) {
  // Prevent command injection — allow only valid domain characters
  return domain.replace(/[^a-zA-Z0-9.\-]/g, '');
}
```

### Step 2: DNS Enumeration

Query DNS records for a target domain.

```bash
# All record types
dig example.com ANY +short

# Specific records
dig example.com A +short
dig example.com MX +short
dig example.com TXT +short
dig example.com NS +short
dig example.com CNAME +short

# Reverse DNS
dig -x 93.184.216.34 +short

# Zone transfer attempt (usually blocked but worth trying)
dig axfr @ns1.example.com example.com
```

```javascript
function dnsRecon(domain) {
  const safe = sanitizeDomain(domain);
  const records = {};

  const types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'];

  for (const type of types) {
    try {
      const result = execSync(`dig ${safe} ${type} +short`, {
        encoding: 'utf8',
        timeout: 10000,
      }).trim();
      records[type] = result ? result.split('\n') : [];
    } catch {
      records[type] = [];
    }
  }

  return { domain, records, timestamp: new Date().toISOString() };
}
```

### Step 3: Subdomain Discovery

Use multiple sources to enumerate subdomains.

```bash
# theHarvester — multi-source email + subdomain harvester
theHarvester -d example.com -b google,bing,dnsdumpster,crtsh -l 500

# Certificate transparency logs (free, no API key needed)
curl -s "https://crt.sh/?q=%25.example.com&output=json" | jq '.[].name_value' | sort -u

# Subfinder (if installed)
subfinder -d example.com -silent
```

```javascript
async function subdomainDiscovery(domain) {
  const safe = sanitizeDomain(domain);
  const subdomains = new Set();

  // Source 1: Certificate Transparency via crt.sh (free, no API key)
  try {
    const crtResult = execSync(
      `curl -s "https://crt.sh/?q=%25.${safe}&output=json" --max-time 30`,
      { encoding: 'utf8', timeout: 35000 }
    );
    const certs = JSON.parse(crtResult);
    for (const cert of certs) {
      const names = cert.name_value.split('\n');
      names.forEach(n => subdomains.add(n.trim().toLowerCase()));
    }
  } catch (err) {
    console.warn(`[osint-recon] crt.sh failed: ${err.message}`);
  }

  // Source 2: theHarvester (if available)
  try {
    const harvestResult = execSync(
      `theHarvester -d ${safe} -b crtsh,dnsdumpster -l 200`,
      { encoding: 'utf8', timeout: 60000 }
    );
    const hostMatches = harvestResult.match(/[\w.-]+\.[a-z]{2,}/gi) || [];
    hostMatches
      .filter(h => h.endsWith(safe))
      .forEach(h => subdomains.add(h.toLowerCase()));
  } catch {
    console.warn('[osint-recon] theHarvester not available or failed');
  }

  return { domain, subdomains: [...subdomains].sort(), count: subdomains.size };
}
```

## Email Harvesting

### Step 4: Find Email Addresses Associated with a Domain

```bash
# theHarvester for emails
theHarvester -d example.com -b google,bing -l 200 | grep '@'

# Hunter.io API (free tier: 25 searches/month)
curl -s "https://api.hunter.io/v2/domain-search?domain=example.com&api_key=YOUR_KEY" | \
  jq '.data.emails[].value'
```

```javascript
async function harvestEmails(domain, apiKeys = {}) {
  const safe = sanitizeDomain(domain);
  const emails = new Set();

  // Source 1: theHarvester
  try {
    const result = execSync(
      `theHarvester -d ${safe} -b google,bing,crtsh -l 200`,
      { encoding: 'utf8', timeout: 120000 }
    );
    const emailMatches = result.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || [];
    emailMatches.forEach(e => emails.add(e.toLowerCase()));
  } catch {
    console.warn('[osint-recon] theHarvester email harvest failed');
  }

  // Source 2: Hunter.io API (if key provided)
  if (apiKeys.hunter_io) {
    try {
      const hunterResult = execSync(
        `curl -s "https://api.hunter.io/v2/domain-search?domain=${safe}&api_key=${apiKeys.hunter_io}"`,
        { encoding: 'utf8', timeout: 15000 }
      );
      const data = JSON.parse(hunterResult);
      (data.data?.emails || []).forEach(e => emails.add(e.value.toLowerCase()));
    } catch {
      console.warn('[osint-recon] Hunter.io API failed');
    }
  }

  return { domain, emails: [...emails].sort(), count: emails.size };
}
```

## Username Hunting

### Step 5: Search for a Username Across Platforms

```bash
# Sherlock — username search across 400+ sites
sherlock targetuser --timeout 10 --print-found

# Specific sites only
sherlock targetuser --site github --site twitter --site instagram --site linkedin
```

```javascript
function huntUsername(username) {
  const safe = username.replace(/[^a-zA-Z0-9._-]/g, '');

  try {
    const result = execSync(
      `sherlock ${safe} --timeout 10 --print-found --no-color 2>&1`,
      { encoding: 'utf8', timeout: 120000 }
    );

    const found = [];
    const lines = result.split('\n');
    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        found.push({
          url: urlMatch[0],
          platform: extractPlatformName(urlMatch[0]),
        });
      }
    }

    return { username: safe, found, count: found.length };
  } catch (err) {
    return { username: safe, error: err.message, found: [] };
  }
}

function extractPlatformName(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname.split('.')[0];
  } catch {
    return 'unknown';
  }
}
```

## IP Intelligence

### Step 6: IP Geolocation and Hosting Info

```bash
# IPInfo (free: 50k lookups/month)
curl -s "https://ipinfo.io/8.8.8.8/json"

# Shodan host lookup (requires free API key)
curl -s "https://api.shodan.io/shodan/host/8.8.8.8?key=YOUR_KEY"

# Basic nmap service scan (non-intrusive)
nmap -sV -T4 --top-ports 100 8.8.8.8
```

```javascript
function ipLookup(ip, apiKeys = {}) {
  const safe = ip.replace(/[^0-9.:a-fA-F]/g, '');
  const results = {};

  // IPInfo (free, no key needed for basic lookups)
  try {
    const ipinfo = execSync(
      `curl -s "https://ipinfo.io/${safe}/json"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    results.ipinfo = JSON.parse(ipinfo);
  } catch {
    results.ipinfo = { error: 'IPInfo lookup failed' };
  }

  // Reverse DNS
  try {
    const rdns = execSync(`dig -x ${safe} +short`, {
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
    results.reverseDns = rdns || null;
  } catch {
    results.reverseDns = null;
  }

  // Shodan (if API key provided)
  if (apiKeys.shodan) {
    try {
      const shodan = execSync(
        `curl -s "https://api.shodan.io/shodan/host/${safe}?key=${apiKeys.shodan}"`,
        { encoding: 'utf8', timeout: 15000 }
      );
      results.shodan = JSON.parse(shodan);
    } catch {
      results.shodan = { error: 'Shodan lookup failed' };
    }
  }

  return { ip: safe, ...results, timestamp: new Date().toISOString() };
}
```

## Social Media Footprinting

### Step 7: Profile Discovery from Name or Handle

```bash
# Search for public profiles using various free tools
# Google dorking for social media
# site:linkedin.com "John Doe"
# site:twitter.com "johndoe"
# site:github.com "johndoe"

# Sherlock for cross-platform username search
sherlock johndoe --print-found --timeout 10
```

```javascript
function socialFootprint(name, platforms = ['github', 'twitter', 'linkedin', 'instagram', 'reddit']) {
  const results = [];

  for (const platform of platforms) {
    const apiUrl = getSocialApiUrl(platform, name);
    if (!apiUrl) continue;

    try {
      const response = execSync(
        `curl -s "${apiUrl}" --max-time 10 -o /dev/null -w "%{http_code}"`,
        { encoding: 'utf8', timeout: 15000 }
      ).trim();

      results.push({
        platform,
        url: getProfileUrl(platform, name),
        status: response === '200' ? 'found' : 'not_found',
        httpCode: parseInt(response),
      });
    } catch {
      results.push({ platform, status: 'error' });
    }
  }

  return { query: name, results, timestamp: new Date().toISOString() };
}

function getProfileUrl(platform, name) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  const urls = {
    github: `https://github.com/${safe}`,
    twitter: `https://x.com/${safe}`,
    linkedin: `https://www.linkedin.com/in/${safe}`,
    instagram: `https://www.instagram.com/${safe}`,
    reddit: `https://www.reddit.com/user/${safe}`,
  };
  return urls[platform] || null;
}

function getSocialApiUrl(platform, name) {
  return getProfileUrl(platform, name);
}
```

## Report Generation

### Step 8: Structure and Export Results

Compile all findings into a structured JSON report.

```javascript
const path = require('path');
const REPORTS_DIR = path.join(process.env.HOME, '.agents', 'data', 'osint-reports');
const INDEX_PATH = path.join(process.env.HOME, '.agents', 'data', 'osint-report-index.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function generateReport(target, findings) {
  const reportId = `OSINT-${Date.now()}`;
  const report = {
    id: reportId,
    target,
    generatedAt: new Date().toISOString(),
    findings,
    toolsUsed: detectToolsUsed(findings),
    summary: generateSummary(findings),
  };

  // Write report to file
  const reportPath = path.join(REPORTS_DIR, `${reportId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Update index
  const index = loadJSON(INDEX_PATH) || { reports: [] };
  index.reports.push({
    id: reportId,
    target,
    generatedAt: report.generatedAt,
    path: reportPath,
  });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));

  return report;
}

function detectToolsUsed(findings) {
  const tools = new Set();
  if (findings.whois) tools.add('whois');
  if (findings.dns) tools.add('dig');
  if (findings.subdomains) tools.add('theHarvester/crt.sh');
  if (findings.emails) tools.add('theHarvester/hunter.io');
  if (findings.username) tools.add('sherlock');
  if (findings.ip) tools.add('ipinfo/shodan');
  return [...tools];
}

function generateSummary(findings) {
  const parts = [];
  if (findings.whois) parts.push(`WHOIS: ${findings.whois.registrar || 'found'}`);
  if (findings.dns) parts.push(`DNS: ${Object.keys(findings.dns.records || {}).length} record types`);
  if (findings.subdomains) parts.push(`Subdomains: ${findings.subdomains.count}`);
  if (findings.emails) parts.push(`Emails: ${findings.emails.count}`);
  if (findings.username) parts.push(`Profiles: ${findings.username.count}`);
  return parts.join(' | ');
}
```

```bash
# List all reports
jq '.reports[] | {id, target, generatedAt}' ~/.agents/data/osint-report-index.json

# View latest report
ls -t ~/.agents/data/osint-reports/*.json | head -1 | xargs jq '.summary'
```

## Full Recon Pipeline

### Step 9: Run a Complete Domain Recon

```javascript
async function fullDomainRecon(domain, options = {}) {
  const apiKeys = loadApiKeys();
  const findings = {};

  console.log(`[osint-recon] Starting full recon on: ${domain}`);

  // Phase 1: WHOIS
  console.log('[osint-recon] Running WHOIS lookup...');
  findings.whois = whoisLookup(domain);

  // Phase 2: DNS
  console.log('[osint-recon] Enumerating DNS records...');
  findings.dns = dnsRecon(domain);

  // Phase 3: Subdomains
  console.log('[osint-recon] Discovering subdomains...');
  findings.subdomains = await subdomainDiscovery(domain);

  // Phase 4: Emails
  console.log('[osint-recon] Harvesting emails...');
  findings.emails = await harvestEmails(domain, apiKeys);

  // Generate and save report
  const report = generateReport(domain, findings);
  console.log(`[osint-recon] Report saved: ${report.id}`);
  console.log(`[osint-recon] Summary: ${report.summary}`);

  return report;
}

async function fullPersonRecon(username, options = {}) {
  const findings = {};

  console.log(`[osint-recon] Starting person recon on: ${username}`);

  // Phase 1: Username hunting
  console.log('[osint-recon] Hunting username across platforms...');
  findings.username = huntUsername(username);

  // Phase 2: Social footprint
  console.log('[osint-recon] Social media footprinting...');
  findings.social = socialFootprint(username);

  const report = generateReport(username, findings);
  console.log(`[osint-recon] Report saved: ${report.id}`);

  return report;
}

function loadApiKeys() {
  const keyPath = path.join(process.env.HOME, '.agents', 'config', 'osint-api-keys.json');
  try {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } catch {
    return {};
  }
}
```

## Quick CLI Commands

### One-Liners for Common Tasks

```bash
# Domain WHOIS
whois example.com | grep -iE 'registrant|name server|creation|expir'

# Subdomain discovery via crt.sh
curl -s "https://crt.sh/?q=%25.example.com&output=json" | jq -r '.[].name_value' | sort -u

# Email harvest
theHarvester -d example.com -b google,bing,crtsh -l 200 2>/dev/null | grep '@'

# Username hunt (top 10 platforms)
sherlock targetuser --print-found --timeout 10 2>/dev/null | head -20

# IP geolocation
curl -s "https://ipinfo.io/8.8.8.8/json" | jq '{ip, city, region, country, org}'

# Nmap quick scan (top 100 ports)
nmap -sV -T4 --top-ports 100 --open 8.8.8.8

# DNS records
dig example.com ANY +short
```

## Ethical and Legal Guidelines

### Scope and Authorization

```markdown
OSINT searches must follow these rules:
1. Only query publicly available information
2. Never attempt unauthorized access to systems
3. Never use credential stuffing or password cracking
4. Respect robots.txt and rate limits on all APIs
5. Do not scrape personal data beyond what is publicly listed
6. Comply with local laws (CFAA in US, GDPR in EU)
7. Document all searches in the report for accountability
```

```bash
# Always check if you have authorization before scanning
echo "REMINDER: Ensure you have written authorization before"
echo "performing any active reconnaissance (nmap, port scans)."
echo "Passive OSINT (WHOIS, DNS, public APIs) is generally"
echo "acceptable for publicly available information."
```

## Tips

- Always sanitize user input before passing to shell commands. The `sanitizeDomain` and username sanitizers strip everything except `[a-zA-Z0-9._-]` to prevent command injection.
- Use crt.sh for subdomain discovery before theHarvester. It is free, requires no API key, and covers certificate transparency logs which catch subdomains other tools miss.
- Sherlock's timeout flag (`--timeout 10`) is critical. Without it, a single unresponsive site can block the entire username hunt for minutes.
- Free API tiers are sufficient for most OSINT work. Shodan free gives 100 queries/month, Hunter.io gives 25 domain searches/month, IPInfo gives 50k lookups/month.
- Export reports as JSON, not plaintext. Structured data enables downstream processing — feeding results into other skills, generating markdown summaries, or comparing across time.
- Never run nmap without explicit authorization. Passive OSINT (WHOIS, DNS, public APIs) is generally acceptable; active scanning (port scans, service detection) requires written permission from the target owner.
- The report index at `~/.agents/data/osint-report-index.json` enables searching historical recon. Query it with `jq` to find previous scans of the same target.
- Rate-limit all API calls. Even free APIs have quotas, and getting banned from Shodan or Hunter.io mid-investigation wastes time.
- Run domain recon and person recon as separate pipelines. They use different tool chains and have different authorization requirements.
- Keep API keys in `~/.agents/config/osint-api-keys.json`, not in environment variables. Config files are easier to rotate and audit than env vars scattered across shell profiles.
