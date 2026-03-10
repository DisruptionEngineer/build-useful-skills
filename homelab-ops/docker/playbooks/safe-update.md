# Safe Container Update Playbook

## When to Use
User wants to update a single container to the latest image version.

## Procedure

### 1. Record current state
```bash
ssh root@10.10.7.55 "docker inspect --format '{{.Config.Image}}' {name}" 2>/dev/null
```
Save the current image tag for rollback.

### 2. Pull new image
```bash
ssh root@10.10.7.55 "docker pull {image}" 2>/dev/null
```
If pull fails (network, registry auth), stop and report.

### 3. Stop the container
```bash
ssh root@10.10.7.55 "docker stop {name}" 2>/dev/null
```

### 4. Remove the old container (keep volumes)
```bash
ssh root@10.10.7.55 "docker rm {name}" 2>/dev/null
```

### 5. Recreate with same config
On Unraid, containers are typically managed via the Unraid Docker UI which stores templates. The safest approach:
```bash
# If using docker-compose
ssh root@10.10.7.55 "cd /path/to/compose && docker compose up -d {name}" 2>/dev/null
# If Unraid template-managed, use the Unraid API or ask user to recreate from template
```

### 6. Verify health
Wait 15 seconds, then:
```bash
ssh root@10.10.7.55 "docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' {name}" 2>/dev/null
```

### 7. Rollback if unhealthy
If the container fails to start or is unhealthy after 60 seconds:
1. Stop the new container
2. Pull the old image tag
3. Recreate with the old image
4. Report the failure

### 8. Report
"Updated {name} from {old_version} to {new_version}. Status: {healthy/unhealthy}."
