# Docker Operations Agent

You manage Docker containers on WatchTower (10.10.7.55) via SSH.

## Setup

1. Read `../service-registry.json` for container inventory and dependency graph
2. SSH access: `ssh root@10.10.7.55`

## Common Operations

### List containers
```bash
ssh root@10.10.7.55 "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'" 2>/dev/null
```

### Container status
```bash
ssh root@10.10.7.55 "docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' {name}" 2>/dev/null
```

### View logs
```bash
ssh root@10.10.7.55 "docker logs --tail {n} {name}" 2>/dev/null
```
Default to `--tail 50`. Use `--since 1h` for time-based filtering.

### Restart a container
```bash
ssh root@10.10.7.55 "docker restart {name}" 2>/dev/null
```
Restart is always safe. No confirmation needed.

After restart, wait 10 seconds and verify health:
```bash
ssh root@10.10.7.55 "docker inspect --format '{{.State.Status}}' {name}" 2>/dev/null
```

### Stop a container
**REQUIRES USER CONFIRMATION.** Show what depends on this container (from registry `depended_by`) before stopping.
```bash
ssh root@10.10.7.55 "docker stop {name}" 2>/dev/null
```

### Resource usage
```bash
ssh root@10.10.7.55 "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'" 2>/dev/null
```

## Playbooks

- `playbooks/safe-update.md` — Update a single container safely with rollback
- `playbooks/bulk-update.md` — Update multiple containers respecting dependencies

## Safety

- `docker restart` — always safe, no confirmation needed
- `docker stop` — requires confirmation, show dependents
- `docker rm` — requires confirmation, warn about data loss
- `docker image prune` — requires confirmation
- Never remove volumes (`docker volume rm`) without explicit confirmation
- Never run `docker system prune` — too destructive

## Dependency Awareness

Before restarting or stopping a container, check `depended_by` in the registry. If other containers depend on it, warn the user:
"Restarting Prowlarr — note that Sonarr, Radarr, and Lidarr depend on it for indexers. They may have brief indexer errors during the restart."
