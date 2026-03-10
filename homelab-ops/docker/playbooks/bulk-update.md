# Bulk Container Update Playbook

## When to Use
User wants to update multiple containers (e.g., "update all arr apps").

## Procedure

### 1. Build update list
Read the registry. For the requested group (e.g., `arr_stack`), list all containers.

### 2. Determine update order using dependency graph
Read `feeds_into` from registry. Update in dependency order — leaf nodes first:
- Leaf services (no `feeds_into` targets): can update in parallel
- Upstream services: update after their downstream dependents are healthy

Example for arr_stack:
1. First: Bazarr, Readarr (leaf nodes)
2. Then: Sonarr, Radarr, Lidarr (depend on Prowlarr + SABnzbd)
3. Last: Prowlarr (everything depends on it)

### 3. Show the plan
**REQUIRES USER APPROVAL before executing.**

Present:
```
Bulk update plan for arr_stack:
  Phase 1: bazarr, readarr (no dependents)
  Phase 2: sonarr, radarr, lidarr
  Phase 3: prowlarr (upstream for all *arr)
Proceed? (yes/no)
```

### 4. Execute phase by phase
For each phase, run safe-update.md for each container. After each phase, verify all containers are healthy before proceeding.

### 5. Report
"Bulk update complete. {n}/{total} containers updated successfully. {failures} failures."
