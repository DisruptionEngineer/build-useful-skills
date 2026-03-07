---
name: paperless-query
description: Search, upload, and manage documents in Paperless-NGX. Use when finding documents by keyword, tag, correspondent, or date range, uploading scanned files with auto-tagging, listing or creating tags, querying document types or correspondents, checking recent additions, or pulling document statistics. Targets the Paperless-NGX REST API with token authentication.
metadata: {"clawdbot":{"emoji":"📄","requires":{"anyBins":["curl","python3"]},"os":["linux","darwin","win32"]}}
---

# Paperless Query

Search, upload, tag, and manage documents in a self-hosted Paperless-NGX instance via its REST API. Covers full-text search, tag and correspondent filtering, date-range queries, document uploads, tag management, and statistics. All requests authenticate with an API token passed as `PAPERLESS_TOKEN`.

## When to Use

- Finding a specific document by keyword ("find the car insurance document")
- Filtering documents by tag, correspondent, or document type
- Querying documents within a date range ("receipts from last month", "tax docs from 2025")
- Uploading a scanned document with automatic or manual tagging
- Listing, creating, or assigning tags to documents
- Checking what was recently added to the archive
- Getting document counts and statistics by tag, type, or correspondent
- Answering "What documents do we have from the dentist?"

## Prerequisites

### Environment Variables

```bash
# Required: API token for authentication
export PAPERLESS_TOKEN="your-api-token-here"

# Optional: override the default base URL
export PAPERLESS_URL="https://paperless.hotmessexpress.xyz"
```

Generate a token from the Paperless-NGX admin panel at `/admin/authtoken/tokenproxy/` or via the API:

```bash
curl -s -X POST "https://paperless.hotmessexpress.xyz/api/token/" \
  -H "Content-Type: application/json" \
  -d '{"username":"derek","password":"YOUR_PASSWORD"}' | jq -r '.token'
```

### Verify Connectivity

```bash
# Quick health check — should return your username
curl -s "https://paperless.hotmessexpress.xyz/api/ui_settings/" \
  -H "Authorization: Token $PAPERLESS_TOKEN" | jq '.user'
```

### Known Configuration

| Entity          | Values                                                                                      |
|-----------------|---------------------------------------------------------------------------------------------|
| Users           | derek, rachel (both via Authentik SSO)                                                      |
| Tags            | receipts, medical, school, bills, home, insurance, tax, pets, kids, auto                    |
| Document types  | Receipt, Invoice, Contract, Medical Record, Insurance Policy, Tax Document, School Form, Correspondence, Manual/Guide, ID/Certificate |
| Correspondents  | Hospital, Dentist, School, Insurance Co, IRS, Bank, Landlord, Veterinarian, Utility Co, Employer |

## API Authentication

Every request needs the `Authorization` header:

```bash
AUTH_HEADER="Authorization: Token $PAPERLESS_TOKEN"

# All curl examples below assume this variable
```

```python
import os, requests

BASE = os.getenv("PAPERLESS_URL", "https://paperless.hotmessexpress.xyz")
HEADERS = {"Authorization": f"Token {os.environ['PAPERLESS_TOKEN']}"}

def api_get(path, params=None):
    resp = requests.get(f"{BASE}/api/{path}", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json()
```

## Document Search

### Full-Text Search

Paperless-NGX indexes document content with full-text search via the `query` parameter.

```bash
# Search for "car insurance"
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?query=car+insurance" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, created: .created, correspondent, tags}'
```

```python
results = api_get("documents/", params={"query": "car insurance"})
for doc in results["results"]:
    print(f"[{doc['id']}] {doc['title']}  (created: {doc['created'][:10]})")
```

### Filter by Tag

Resolve tag names to IDs first, then filter.

```bash
# Step 1: Get the tag ID for "receipts"
TAG_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/tags/?name__iexact=receipts" \
  -H "$AUTH_HEADER" | jq '.results[0].id')

# Step 2: Filter documents by that tag
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?tags__id__in=$TAG_ID" \
  -H "$AUTH_HEADER" | jq '.count, (.results[:5][] | {id, title, created: .created})'
```

```python
def get_tag_id(name):
    data = api_get("tags/", params={"name__iexact": name})
    if data["results"]:
        return data["results"][0]["id"]
    return None

def docs_by_tag(tag_name, limit=10):
    tag_id = get_tag_id(tag_name)
    if not tag_id:
        return f"Tag '{tag_name}' not found"
    data = api_get("documents/", params={"tags__id__in": tag_id, "page_size": limit})
    return data["results"]
```

### Filter by Multiple Tags

```bash
# Documents tagged both "medical" AND "kids" — use tags__id__all for AND logic
MEDICAL_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/tags/?name__iexact=medical" \
  -H "$AUTH_HEADER" | jq '.results[0].id')
KIDS_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/tags/?name__iexact=kids" \
  -H "$AUTH_HEADER" | jq '.results[0].id')
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?tags__id__all=$MEDICAL_ID,$KIDS_ID" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title}'
```

### Filter by Correspondent

```bash
# Get correspondent ID for "Dentist"
CORR_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/correspondents/?name__iexact=Dentist" \
  -H "$AUTH_HEADER" | jq '.results[0].id')

# List all documents from the dentist
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?correspondent__id=$CORR_ID" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, created: .created}'
```

### Filter by Document Type

```bash
# Get document type ID for "Tax Document"
TYPE_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/document_types/?name__iexact=Tax+Document" \
  -H "$AUTH_HEADER" | jq '.results[0].id')

# List all tax documents
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?document_type__id=$TYPE_ID" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, created: .created}'
```

### Date Range Queries

```bash
# Documents created after January 1, 2025
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?created__date__gt=2025-01-01" \
  -H "$AUTH_HEADER" | jq '.count'

# Documents added in the last 30 days
SINCE=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '30 days ago' +%Y-%m-%d)
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?added__date__gt=$SINCE" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, added}'

# Tax documents from 2025 specifically
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?document_type__id=$TYPE_ID&created__date__gt=2025-01-01&created__date__lt=2026-01-01" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, created: .created}'
```

```python
from datetime import datetime, timedelta

def docs_since(days_ago):
    since = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    return api_get("documents/", params={"added__date__gt": since, "ordering": "-added"})

# Receipts from last month
def receipts_last_month():
    tag_id = get_tag_id("receipts")
    first = (datetime.now().replace(day=1) - timedelta(days=1)).replace(day=1).strftime("%Y-%m-%d")
    last = datetime.now().replace(day=1).strftime("%Y-%m-%d")
    return api_get("documents/", params={
        "tags__id__in": tag_id,
        "created__date__gt": first,
        "created__date__lt": last
    })
```

### Combined Search (Keyword + Filters)

```bash
# Full-text search for "deductible" within documents tagged "insurance"
TAG_ID=$(curl -s "https://paperless.hotmessexpress.xyz/api/tags/?name__iexact=insurance" \
  -H "$AUTH_HEADER" | jq '.results[0].id')

curl -s "https://paperless.hotmessexpress.xyz/api/documents/?query=deductible&tags__id__in=$TAG_ID" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, created: .created}'
```

## Document Upload

Upload a file to Paperless-NGX for processing. The system will OCR, classify, and (with Paperless-AI/GPT) auto-tag.

```bash
# Upload a PDF — Paperless will auto-classify
curl -s -X POST "https://paperless.hotmessexpress.xyz/api/documents/post_document/" \
  -H "$AUTH_HEADER" \
  -F "document=@/path/to/scan.pdf" \
  -F "title=Dentist Visit Receipt 2025-03" | jq '.'

# Upload with explicit tags and correspondent
curl -s -X POST "https://paperless.hotmessexpress.xyz/api/documents/post_document/" \
  -H "$AUTH_HEADER" \
  -F "document=@/path/to/invoice.pdf" \
  -F "title=Electric Bill March 2025" \
  -F "tags=3,6" \
  -F "correspondent=9" \
  -F "document_type=2"
```

```python
def upload_document(filepath, title=None, tags=None, correspondent=None, doc_type=None):
    url = f"{BASE}/api/documents/post_document/"
    files = {"document": open(filepath, "rb")}
    data = {}
    if title:
        data["title"] = title
    if tags:
        # tags is a list of tag IDs
        for tag_id in tags:
            data.setdefault("tags", []).append(tag_id)
    if correspondent:
        data["correspondent"] = correspondent
    if doc_type:
        data["document_type"] = doc_type
    resp = requests.post(url, headers=HEADERS, files=files, data=data)
    resp.raise_for_status()
    return resp.json()

# Example: upload a receipt and tag it
receipt_tag = get_tag_id("receipts")
upload_document("/tmp/scan.pdf", title="Grocery Receipt", tags=[receipt_tag])
```

### Upload Status

After uploading, the document enters a processing queue. Check task status:

```bash
# List pending tasks
curl -s "https://paperless.hotmessexpress.xyz/api/tasks/" \
  -H "$AUTH_HEADER" | jq '.[] | {id: .task_id, status: .status, task_file_name, result}'
```

## Tag Management

### List All Tags

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/tags/" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, name, document_count}'
```

```python
def list_tags():
    data = api_get("tags/", params={"page_size": 100})
    return [(t["id"], t["name"], t["document_count"]) for t in data["results"]]
```

### Create a New Tag

```bash
curl -s -X POST "https://paperless.hotmessexpress.xyz/api/tags/" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"name":"warranty","color":"#4caf50","matching_algorithm":1,"match":"warranty"}' | jq '{id, name}'
```

```python
def create_tag(name, color="#000000", match_algo=1, match_pattern=None):
    payload = {"name": name, "color": color, "matching_algorithm": match_algo}
    if match_pattern:
        payload["match"] = match_pattern
    resp = requests.post(f"{BASE}/api/tags/", headers={**HEADERS, "Content-Type": "application/json"}, json=payload)
    resp.raise_for_status()
    return resp.json()
```

### Assign Tags to a Document

```bash
# Add tag ID 5 (insurance) to document ID 42
curl -s -X PATCH "https://paperless.hotmessexpress.xyz/api/documents/42/" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"tags":[5,10]}' | jq '{id, title, tags}'
```

```python
def assign_tags(doc_id, tag_ids):
    """Replace all tags on a document. Merges with existing if needed."""
    # First get existing tags
    doc = api_get(f"documents/{doc_id}/")
    existing = set(doc["tags"])
    merged = list(existing.union(set(tag_ids)))
    resp = requests.patch(
        f"{BASE}/api/documents/{doc_id}/",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"tags": merged}
    )
    resp.raise_for_status()
    return resp.json()
```

### Tag Matching Algorithms

| Algorithm | Value | Behavior                              |
|-----------|-------|---------------------------------------|
| None      | 0     | No auto-matching                      |
| Any       | 1     | Match if any word in `match` appears  |
| All       | 2     | Match if all words in `match` appear  |
| Exact     | 3     | Match exact string                    |
| Regex     | 4     | Match regular expression              |
| Fuzzy     | 5     | Fuzzy match with threshold            |
| Auto      | 6     | ML-based classification               |

## Correspondent Queries

### List All Correspondents

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/correspondents/" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, name, document_count}'
```

### Documents from a Specific Correspondent

```python
def docs_by_correspondent(name, limit=20):
    corr = api_get("correspondents/", params={"name__iexact": name})
    if not corr["results"]:
        return f"Correspondent '{name}' not found"
    corr_id = corr["results"][0]["id"]
    return api_get("documents/", params={"correspondent__id": corr_id, "page_size": limit})
```

### List Document Types

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/document_types/" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, name, document_count}'
```

## Recent Documents

### Last N Documents Added

```bash
# Last 5 documents added to the system
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?ordering=-added&page_size=5" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, added, correspondent, tags}'
```

```python
def recent_docs(n=5):
    data = api_get("documents/", params={"ordering": "-added", "page_size": n})
    for doc in data["results"]:
        print(f"[{doc['id']}] {doc['title']}  added: {doc['added'][:10]}")
    return data["results"]
```

### Last Modified Documents

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?ordering=-modified&page_size=5" \
  -H "$AUTH_HEADER" | jq '.results[] | {id, title, modified: .modified}'
```

## Statistics and Counts

### Total Document Count

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/documents/?page_size=1" \
  -H "$AUTH_HEADER" | jq '.count'
```

### Counts by Tag

```bash
# Document count for every tag
curl -s "https://paperless.hotmessexpress.xyz/api/tags/?page_size=100" \
  -H "$AUTH_HEADER" | jq '.results | sort_by(-.document_count) | .[] | "\(.name): \(.document_count)"'
```

```python
def stats_by_tag():
    tags = api_get("tags/", params={"page_size": 100})["results"]
    tags.sort(key=lambda t: -t["document_count"])
    total = sum(t["document_count"] for t in tags)
    print(f"Total tag assignments: {total}")
    for t in tags:
        print(f"  {t['name']}: {t['document_count']}")
    return tags
```

### Counts by Document Type

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/document_types/?page_size=100" \
  -H "$AUTH_HEADER" | jq '.results | sort_by(-.document_count) | .[] | "\(.name): \(.document_count)"'
```

### Counts by Correspondent

```bash
curl -s "https://paperless.hotmessexpress.xyz/api/correspondents/?page_size=100" \
  -H "$AUTH_HEADER" | jq '.results | sort_by(-.document_count) | .[] | "\(.name): \(.document_count)"'
```

### Full Statistics Summary

```python
def full_stats():
    docs = api_get("documents/", params={"page_size": 1})
    tags = api_get("tags/", params={"page_size": 100})
    types = api_get("document_types/", params={"page_size": 100})
    corrs = api_get("correspondents/", params={"page_size": 100})

    print(f"Total documents: {docs['count']}")
    print(f"Tags: {tags['count']}")
    print(f"Document types: {types['count']}")
    print(f"Correspondents: {corrs['count']}")
    print("\nTop tags:")
    for t in sorted(tags["results"], key=lambda x: -x["document_count"])[:5]:
        print(f"  {t['name']}: {t['document_count']}")
    print("\nTop correspondents:")
    for c in sorted(corrs["results"], key=lambda x: -x["document_count"])[:5]:
        print(f"  {c['name']}: {c['document_count']}")
```

## Natural Language Query Parsing

Map common phrasing to API parameters.

```python
import re
from datetime import datetime, timedelta

QUERY_PATTERNS = {
    "tag": [
        r"(?:tagged|tag|with tag)\s+(\w+)",
        r"(?:show|find|get|list)\s+(\w+)\b.*(?:documents?|docs?|files?)",
        r"(\w+)\s+(?:documents?|docs?|files?|receipts?|records?)",
    ],
    "correspondent": [
        r"(?:from|by)\s+(?:the\s+)?(.+?)(?:\s*[\?\.]|$)",
        r"(?:documents?|docs?|files?)\s+from\s+(?:the\s+)?(.+?)(?:\s*[\?\.]|$)",
    ],
    "date_relative": [
        r"(?:last|past)\s+(\d+)?\s*(day|week|month|year)s?",
        r"from\s+(\d{4})",
        r"(?:since|after)\s+(\w+\s+\d{4}|\d{4}-\d{2}-\d{2})",
    ],
    "recent": [
        r"(?:last|latest|most recent|newest)\s+(?:document|doc|file|addition)",
        r"what was (?:just |last |recently )?added",
    ],
    "stats": [
        r"how many (?:documents?|docs?|files?)",
        r"(?:count|total|statistics|stats)",
    ],
}

TAG_NAMES = ["receipts", "medical", "school", "bills", "home",
             "insurance", "tax", "pets", "kids", "auto"]
CORRESPONDENT_NAMES = ["hospital", "dentist", "school", "insurance co",
                       "irs", "bank", "landlord", "veterinarian",
                       "utility co", "employer"]

def parse_query(text):
    """Parse a natural language query into Paperless API parameters."""
    lower = text.lower().strip()
    params = {}

    # Check for stats queries
    for pattern in QUERY_PATTERNS["stats"]:
        if re.search(pattern, lower):
            return {"action": "stats"}

    # Check for recent document queries
    for pattern in QUERY_PATTERNS["recent"]:
        if re.search(pattern, lower):
            return {"action": "recent", "params": {"ordering": "-added", "page_size": 5}}

    # Extract tag references
    for tag in TAG_NAMES:
        if tag in lower:
            params["tag"] = tag
            break

    # Extract correspondent references
    for corr in CORRESPONDENT_NAMES:
        if corr in lower:
            params["correspondent"] = corr
            break

    # Extract date ranges
    rel_match = re.search(r"(?:last|past)\s+(\d+)?\s*(day|week|month|year)s?", lower)
    if rel_match:
        amount = int(rel_match.group(1) or 1)
        unit = rel_match.group(2)
        days = {"day": 1, "week": 7, "month": 30, "year": 365}[unit]
        since = (datetime.now() - timedelta(days=amount * days)).strftime("%Y-%m-%d")
        params["date_after"] = since

    year_match = re.search(r"from\s+(\d{4})\b", lower)
    if year_match:
        year = year_match.group(1)
        params["date_after"] = f"{year}-01-01"
        params["date_before"] = f"{int(year)+1}-01-01"

    # Extract search keywords (remove stop words and known entities)
    stop = {"find", "show", "get", "list", "the", "all", "my", "our", "a",
            "documents", "document", "docs", "doc", "files", "file", "from",
            "with", "tagged", "last", "past", "recent", "month", "year",
            "week", "day", "what", "was", "were", "is", "are"}
    words = [w for w in re.findall(r'\w+', lower)
             if w not in stop and w not in TAG_NAMES and w not in CORRESPONDENT_NAMES]
    if words:
        params["query"] = " ".join(words)

    return {"action": "search", "params": params}
```

### Translating Parsed Query to API Call

```python
def execute_query(parsed):
    if parsed["action"] == "stats":
        return full_stats()
    if parsed["action"] == "recent":
        return api_get("documents/", params=parsed["params"])

    p = parsed["params"]
    api_params = {}

    if "query" in p:
        api_params["query"] = p["query"]
    if "tag" in p:
        tag_id = get_tag_id(p["tag"])
        if tag_id:
            api_params["tags__id__in"] = tag_id
    if "correspondent" in p:
        corr = api_get("correspondents/", params={"name__icontains": p["correspondent"]})
        if corr["results"]:
            api_params["correspondent__id"] = corr["results"][0]["id"]
    if "date_after" in p:
        api_params["created__date__gt"] = p["date_after"]
    if "date_before" in p:
        api_params["created__date__lt"] = p["date_before"]

    api_params["ordering"] = "-created"
    api_params["page_size"] = 20

    return api_get("documents/", params=api_params)
```

## Viewing and Downloading Documents

```bash
# Full metadata for document ID 42
curl -s "https://paperless.hotmessexpress.xyz/api/documents/42/" \
  -H "$AUTH_HEADER" | jq '{id, title, content: .content[:200], created, correspondent, document_type, tags}'

# Download the original uploaded file
curl -s -o document_42_original.pdf \
  "https://paperless.hotmessexpress.xyz/api/documents/42/download/" \
  -H "$AUTH_HEADER"

# Download the archived (OCR-processed) version
curl -s -o document_42_archive.pdf \
  "https://paperless.hotmessexpress.xyz/api/documents/42/download/?original=false" \
  -H "$AUTH_HEADER"

# Get thumbnail
curl -s -o thumb_42.png \
  "https://paperless.hotmessexpress.xyz/api/documents/42/thumb/" \
  -H "$AUTH_HEADER"
```

## Bulk Operations

```bash
# Add tag ID 3 to documents 10, 11, 12
curl -s -X POST "https://paperless.hotmessexpress.xyz/api/documents/bulk_edit/" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [10, 11, 12],
    "method": "modify_tags",
    "parameters": {"add_tags": [3], "remove_tags": []}
  }'
```

```python
def bulk_add_tag(doc_ids, tag_id):
    resp = requests.post(
        f"{BASE}/api/documents/bulk_edit/",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={
            "documents": doc_ids,
            "method": "modify_tags",
            "parameters": {"add_tags": [tag_id], "remove_tags": []}
        }
    )
    resp.raise_for_status()
    return resp.json()
```

## Tips

- The `query` parameter does full-text search across document content, title, and ASN. It is the fastest way to find something when you know a keyword from the actual document text.
- Use `name__iexact` for exact case-insensitive tag/correspondent lookups and `name__icontains` for partial matches. Avoid `name__exact` unless you know the precise casing.
- Date filters use `created` (the document's date, often extracted from content) vs `added` (when it entered Paperless). For "when was this uploaded" use `added__date__gt`; for "documents from 2025" use `created__date__gt`.
- The `ordering` parameter accepts `-created`, `-added`, `-modified`, `title`, `-title`. Prefix with `-` for descending. Default is relevance when `query` is present.
- Upload via `post_document/` returns a task ID, not the document itself. The file goes through OCR and classification first. Poll `/api/tasks/` to check when processing finishes.
- Paperless-AI and Paperless-GPT run alongside the main instance for auto-classification. Uploaded documents get auto-tagged without manual intervention in most cases.
- Tag IDs are stable integers. Cache the tag-name-to-ID mapping locally if making many filtered queries in a session to avoid redundant API calls.
- The `page_size` parameter defaults to 25. Set it to `100` for bulk operations or `1` when you only need the count. Maximum is 100.
- When combining `query` with tag/correspondent filters, the full-text search runs first and filters narrow the result. This is efficient for queries like "find 'deductible' in insurance documents."
- Both derek and rachel authenticate via Authentik SSO, but API token auth bypasses SSO entirely. Keep the token in an environment variable, never in committed code.
