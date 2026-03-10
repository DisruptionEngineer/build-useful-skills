# Download Troubleshooting Playbook

## When to Use
User reports: downloads stuck, slow, failing, or items not being grabbed.

## Procedure

### 1. Check SABnzbd status
```bash
curl -s "http://10.10.7.55:8080/api?mode=queue&output=json&apikey=$SABNZBD_API_KEY"
```
Check: is SABnzbd paused? Are there items in queue? Any errors?

### 2. Check *arr queue
```bash
curl -s -H "X-Api-Key: $SONARR_API_KEY" "http://10.10.7.55:8989/api/v3/queue?page=1&pageSize=50"
```
Look for items with warnings or errors in `statusMessages`.

### 3. Check disk space
```bash
ssh root@10.10.7.55 "df -h /mnt/user/downloads /mnt/user/media" 2>/dev/null
```
If download or media drives are full, nothing can download or import.

### 4. Check container logs for errors
```bash
ssh root@10.10.7.55 "docker logs --tail 50 sonarr" 2>/dev/null
ssh root@10.10.7.55 "docker logs --tail 50 sabnzbd" 2>/dev/null
```

### 5. Common fixes
- SABnzbd paused → Resume: `curl -s "http://10.10.7.55:8080/api?mode=resume&apikey=$SABNZBD_API_KEY"`
- Disk full → Alert user, suggest cleanup
- Import errors → Check path mappings between *arr and download client
- Indexer errors → Escalate to indexer-health playbook

### 6. Report
Summarize: download client status, queue depth, any errors, disk space, and recommended actions.
