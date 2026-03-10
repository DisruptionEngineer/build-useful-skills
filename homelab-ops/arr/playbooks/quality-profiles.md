# Quality Profiles Playbook

## When to Use
User wants to view, modify, or understand quality profiles in Sonarr/Radarr.

## View Profiles
```bash
# Sonarr
curl -s -H "X-Api-Key: $SONARR_API_KEY" "http://10.10.7.55:8989/api/v3/qualityprofile"
# Radarr
curl -s -H "X-Api-Key: $RADARR_API_KEY" "http://10.10.7.55:7878/api/v3/qualityprofile"
```

Present profiles as a readable list: name, cutoff quality, allowed qualities.

## Modify a Profile

**REQUIRES USER CONFIRMATION before applying.**

1. Fetch the profile by ID
2. Show the user the current state and proposed change
3. Wait for explicit "yes" / approval
4. PUT the modified profile back:
```bash
curl -s -X PUT -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{modified_profile_json}' \
  "http://10.10.7.55:{port}/api/v3/qualityprofile/{id}"
```

## Common Requests
- "What quality profiles do I have?" → List all profiles
- "What quality is X set to?" → Find the series/movie, check its profileId, look up the profile
- "Upgrade X to 4K" → Find the 4K profile (or create one), assign it to the item
