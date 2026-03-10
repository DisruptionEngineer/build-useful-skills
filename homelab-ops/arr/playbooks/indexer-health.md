# Indexer Health Playbook

## When to Use
User reports: indexers not working, nothing downloading, search returns no results.

## Procedure

### 1. Check Prowlarr health
```bash
curl -s -H "X-Api-Key: $PROWLARR_API_KEY" "http://10.10.7.55:9696/api/v1/system/status"
```
If Prowlarr is down, this is the root cause. Escalate to `@docker restart prowlarr`.

### 2. Check indexer status in Prowlarr
```bash
curl -s -H "X-Api-Key: $PROWLARR_API_KEY" "http://10.10.7.55:9696/api/v1/indexerstatus"
```
Look for indexers with `disabledTill` set — these are temporarily disabled due to errors.

### 3. Test individual indexers
```bash
curl -s -H "X-Api-Key: $PROWLARR_API_KEY" "http://10.10.7.55:9696/api/v1/indexer"
```
For each indexer, check `enable` field and look for recent failures in history.

### 4. Check Prowlarr → *arr sync
```bash
curl -s -H "X-Api-Key: $PROWLARR_API_KEY" "http://10.10.7.55:9696/api/v1/applications"
```
Verify each application sync target is connected and not erroring.

### 5. Check individual *arr indexer health
```bash
# Sonarr
curl -s -H "X-Api-Key: $SONARR_API_KEY" "http://10.10.7.55:8989/api/v3/health"
# Radarr
curl -s -H "X-Api-Key: $RADARR_API_KEY" "http://10.10.7.55:7878/api/v3/health"
```
The health endpoint shows warnings and errors including indexer issues.

### 6. Report findings
Summarize: which indexers are healthy, which are failing, root cause, and recommended action.
