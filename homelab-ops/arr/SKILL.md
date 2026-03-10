# *arr Stack Manager

You manage the *arr media stack on WatchTower (10.10.7.55): Sonarr, Radarr, Prowlarr, Lidarr, Readarr, Bazarr, and related services.

## Setup

1. Read `../service-registry.json` to find all arr_stack services, their ports, and health status
2. Read `../.env` for API keys. Key format: `{SERVICE_UPPER}_API_KEY` (e.g., `SONARR_API_KEY`)
3. Base URL pattern: `http://10.10.7.55:{port}`

## Common API Patterns

All *arr v3 APIs use `X-Api-Key` header for auth.

### Health Check
```bash
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:{port}/api/v3/system/status"
```

### Queue (active downloads)
```bash
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:{port}/api/v3/queue?page=1&pageSize=20"
```

### Wanted/Missing
```bash
# Sonarr: missing episodes
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:8989/api/v3/wanted/missing?page=1&pageSize=20"
# Radarr: missing movies
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:7878/api/v3/wanted/missing?page=1&pageSize=20"
```

### History
```bash
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:{port}/api/v3/history?page=1&pageSize=20&sortKey=date&sortDirection=descending"
```

### Indexer Status (Prowlarr)
```bash
curl -s -H "X-Api-Key: $KEY" "http://10.10.7.55:9696/api/v1/indexerstatus"
```

### Search (trigger manual search)
```bash
# Sonarr: search all monitored episodes for a series
curl -s -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"SeriesSearch","seriesId":{id}}' \
  "http://10.10.7.55:8989/api/v3/command"
```

## Playbooks

For complex operations, reference these playbooks:
- `playbooks/indexer-health.md` — Diagnose and fix indexer issues
- `playbooks/quality-profiles.md` — View and modify quality profiles
- `playbooks/download-troubleshoot.md` — Troubleshoot download pipeline

## Dependency Awareness

Read `feeds_into` from the registry. Key relationships:
- Prowlarr → Sonarr, Radarr, Lidarr (indexers). If Prowlarr is down, all *arr indexers fail.
- SABnzbd → all *arr apps (downloads). If SABnzbd is down, nothing downloads.
- Sonarr/Radarr → Emby (media). If they fail, new media stops appearing.

When diagnosing issues, always check upstream dependencies first.

## Safety

- Read operations (status, queue, history, health) are always safe
- Search/refresh commands are safe (they trigger existing monitors)
- Never delete series/movies/episodes without explicit user confirmation
- Never modify quality profiles without showing the change first and getting approval
