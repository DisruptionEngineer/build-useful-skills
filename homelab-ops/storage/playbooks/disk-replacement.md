# Disk Replacement Playbook

## When to Use
User needs to replace a failing or failed disk.

## IMPORTANT
This is a multi-step, potentially destructive process. **Get explicit user confirmation at EVERY step.** If anything looks wrong, stop and ask the user.

## Pre-Replacement

### 1. Identify the failing disk
```bash
ssh root@10.10.7.55 "smartctl -a /dev/sd{x}" 2>/dev/null
```
Look for: Reallocated_Sector_Ct > 0, Current_Pending_Sector > 0, SMART overall-health: FAILED.

### 2. Check current array status
```bash
ssh root@10.10.7.55 "cat /var/local/emhttp/var.ini | grep -E 'mdState|rdevStatus'" 2>/dev/null
```

### 3. Ensure parity is valid
A disk rebuild requires valid parity. If parity is invalid, warn the user that replacement may result in data loss.

## Replacement Steps

**Walk through these with the user. Do NOT automate the full sequence.**

1. Stop the array (REQUIRES CONFIRMATION)
2. User physically replaces the disk
3. Assign new disk in Unraid UI (guide user through the web interface)
4. Start the array (REQUIRES CONFIRMATION)
5. Unraid will automatically begin rebuilding
6. Monitor rebuild progress

## Post-Replacement
```bash
# Monitor rebuild
ssh root@10.10.7.55 "cat /var/local/emhttp/var.ini | grep -E 'mdResync|mdResyncPos|mdResyncSize'" 2>/dev/null
```
Report progress percentage and estimated time remaining. Warn user not to add/remove other disks during rebuild.
