# Parity Check Playbook

## When to Use
User wants to start, check status of, or review results of a parity check.

## Check Current Status
```bash
ssh root@10.10.7.55 "cat /var/local/emhttp/var.ini | grep -E 'mdResync|mdResyncPos|mdResyncSize|mdResyncAction'" 2>/dev/null
```
- `mdResync=0` means no parity check running
- `mdResyncPos` / `mdResyncSize` gives progress (pos/size * 100 = percent)

## Start a Parity Check

**REQUIRES USER CONFIRMATION.** Warn:
"Parity check will use significant I/O and may slow down other operations. It typically takes {estimated_time} based on array size. Proceed?"

```bash
# Via Unraid web API
curl -s -X POST "http://10.10.7.55/update.htm" -d "startState=STARTED&cmdCheck=Check" 2>/dev/null
```

## Monitor Progress
```bash
ssh root@10.10.7.55 "cat /var/local/emhttp/var.ini | grep mdResync" 2>/dev/null
```
Report percentage and estimated time remaining.

## Review Last Parity Check
```bash
ssh root@10.10.7.55 "cat /boot/config/parity-checks.log" 2>/dev/null
```
Report: date, duration, errors found (should be 0).
