---
name: ha-device-control
description: Control Home Assistant devices via the HA REST API and WebSocket. Use when turning on/off lights, adjusting thermostats, locking/unlocking doors, querying device states, triggering automations or scripts, requesting Frigate camera snapshots, listing entities by area or type, or interpreting voice commands routed from the voice bridge. Also covers MQTT integration via Mosquitto.
metadata: {"clawdbot":{"emoji":"🏠","requires":{"anyBins":["curl","python3"]},"os":["linux","darwin"]}}
---

# Home Assistant Device Control

Control smart home devices through the Home Assistant REST API and WebSocket interface. This skill covers the full device lifecycle: discovering entities, reading state, calling services (lights, climate, locks, covers, scenes), triggering automations, and pulling Frigate camera snapshots. Commands can originate from Discord, the voice bridge, or direct agent invocations.

## When to Use

- Turning lights on/off, adjusting brightness or color temperature
- Setting thermostat target temperatures or changing HVAC modes
- Locking or unlocking doors and checking lock status
- Querying device states ("Is the garage door open?", "What's the living room temperature?")
- Activating scenes or triggering existing automations/scripts
- Requesting camera snapshots from Frigate
- Listing all devices in a room or all entities of a specific domain
- Diagnosing device availability or connectivity issues via state history

## Prerequisites

### Home Assistant Instance

HA runs at `http://10.10.7.60:8123`. The long-lived access token is stored in the `HA_TOKEN` environment variable (token name: `hme-onboard-2`).

```bash
# Verify connectivity
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/

# Expected: 200
```

```bash
# Verify token is set
echo "${HA_TOKEN:0:10}..." # should print first 10 chars
```

### MQTT Broker

Mosquitto runs at `10.10.7.55:1883` for device integrations that use MQTT.

```bash
# Test MQTT connectivity (requires mosquitto-clients)
mosquitto_pub -h 10.10.7.55 -p 1883 -t "test/ping" -m "hello" -q 1
mosquitto_sub -h 10.10.7.55 -p 1883 -t "test/ping" -C 1 -W 5
```

### Frigate NVR

Frigate runs at `http://10.10.7.55:5000` for camera snapshots and event detection.

```bash
# Verify Frigate is reachable
curl -s -o /dev/null -w "%{http_code}" http://10.10.7.55:5000/api/version
# Expected: 200
```

## Entity ID Conventions

Home Assistant entity IDs follow the pattern `{domain}.{object_id}`. Know these domains:

| Domain | Examples | Controls |
|--------|----------|----------|
| `light` | `light.living_room`, `light.kitchen_island` | on/off, brightness, color_temp, rgb_color |
| `switch` | `switch.garage_outlet`, `switch.porch_fan` | on/off |
| `climate` | `climate.living_room`, `climate.master_bedroom` | temperature, hvac_mode, fan_mode |
| `lock` | `lock.front_door`, `lock.back_door` | lock/unlock |
| `cover` | `cover.garage_door`, `cover.blinds_office` | open/close/stop, position |
| `camera` | `camera.front_yard`, `camera.driveway` | snapshot, stream |
| `binary_sensor` | `binary_sensor.front_door_contact` | state only (on/off) |
| `sensor` | `sensor.outdoor_temperature`, `sensor.humidity` | state only (numeric) |
| `automation` | `automation.night_mode`, `automation.morning_lights` | trigger/toggle |
| `script` | `script.movie_time`, `script.goodnight` | run |
| `scene` | `scene.movie_night`, `scene.bright_kitchen` | activate |
| `fan` | `fan.bedroom_ceiling` | on/off, speed, direction |
| `media_player` | `media_player.living_room_speaker` | play/pause/volume |

## Device Control

### Turn Lights On/Off

```bash
# Turn on a light
curl -s -X POST http://10.10.7.60:8123/api/services/light/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room"}'

# Turn off a light
curl -s -X POST http://10.10.7.60:8123/api/services/light/turn_off \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.living_room"}'
```

### Adjust Light Brightness and Color

```bash
# Set brightness to 50% (0-255 scale; use brightness_pct for 0-100%)
curl -s -X POST http://10.10.7.60:8123/api/services/light/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "light.kitchen_island", "brightness": 128, "color_temp": 350}'
# color_temp in mireds: 153=cold/6500K, 500=warm/2000K. For RGB: "rgb_color": [255, 100, 50]
```

### Thermostat Control

```bash
# Set target temperature
curl -s -X POST http://10.10.7.60:8123/api/services/climate/set_temperature \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.living_room", "temperature": 72}'

# Change HVAC mode (heat, cool, heat_cool, auto, off, fan_only)
curl -s -X POST http://10.10.7.60:8123/api/services/climate/set_hvac_mode \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "climate.living_room", "hvac_mode": "cool"}'
```

### Lock/Unlock Doors

```bash
# Lock the front door
curl -s -X POST http://10.10.7.60:8123/api/services/lock/lock \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "lock.front_door"}'

# Unlock the front door
curl -s -X POST http://10.10.7.60:8123/api/services/lock/unlock \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "lock.front_door"}'
```

### Garage Door / Covers

```bash
# Open the garage door (use close_cover to close, set_cover_position for 0-100%)
curl -s -X POST http://10.10.7.60:8123/api/services/cover/open_cover \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "cover.garage_door"}'
```

### Activate Scenes

```bash
# Activate a scene
curl -s -X POST http://10.10.7.60:8123/api/services/scene/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "scene.movie_night"}'
```

## State Queries

### Get a Single Entity State

```bash
# Check if front door is locked
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states/lock.front_door | jq '{state, last_changed}'

# Output: {"state": "locked", "last_changed": "2026-03-02T14:30:00+00:00"}
```

```bash
# Get thermostat current temperature and setpoint
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states/climate.living_room \
  | jq '{state: .state, current_temp: .attributes.current_temperature, target_temp: .attributes.temperature, hvac_action: .attributes.hvac_action}'

# Output: {"state": "cool", "current_temp": 74.5, "target_temp": 72, "hvac_action": "cooling"}
```

### List All Entity States

```bash
# Get all entity states (large payload — filter with jq)
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states | jq 'length'

# Filter to just lights
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | startswith("light.")) | {entity_id, state, brightness: .attributes.brightness}]'
```

### Python State Query Helper

```python
import os
import requests

HA_URL = "http://10.10.7.60:8123"
HEADERS = {
    "Authorization": f"Bearer {os.environ['HA_TOKEN']}",
    "Content-Type": "application/json",
}

def get_state(entity_id):
    """Get the current state of an entity."""
    resp = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    return {
        "entity_id": data["entity_id"],
        "state": data["state"],
        "attributes": data["attributes"],
        "last_changed": data["last_changed"],
    }

def get_entities_by_domain(domain):
    """List all entities for a given domain (light, switch, climate, etc.)."""
    resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS)
    resp.raise_for_status()
    return [
        {"entity_id": e["entity_id"], "state": e["state"], "name": e["attributes"].get("friendly_name", "")}
        for e in resp.json()
        if e["entity_id"].startswith(f"{domain}.")
    ]
# "Are any lights on?" -> [l for l in get_entities_by_domain("light") if l["state"] == "on"]
```

### Check Entities by Area

```bash
# Use the template API to list all entities in a named area
curl -s -X POST http://10.10.7.60:8123/api/template \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"template": "{% for e in area_entities(\"living_room\") %}{{ e }}\n{% endfor %}"}'
```

## Automation and Script Triggers

### Trigger an Automation

```bash
# Trigger an automation by entity_id
curl -s -X POST http://10.10.7.60:8123/api/services/automation/trigger \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "automation.night_mode"}'
```

### Run a Script

```bash
# Execute a script
curl -s -X POST http://10.10.7.60:8123/api/services/script/turn_on \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "script.goodnight"}'

# Or call the script directly by its object_id
curl -s -X POST http://10.10.7.60:8123/api/services/script/goodnight \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### List Available Automations

```bash
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | startswith("automation.")) | {entity_id, state, name: .attributes.friendly_name}]'
```

### Fire a Custom Event

```bash
# Fire a custom event (useful for triggering event-based automations)
curl -s -X POST http://10.10.7.60:8123/api/events/custom_voice_command \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "goodnight", "source": "discord"}'
```

## Camera Snapshots (Frigate)

### Get a Snapshot from Frigate Directly

```bash
# Latest snapshot from a camera (returns JPEG image)
curl -s -o /tmp/front_yard_snapshot.jpg \
  "http://10.10.7.55:5000/api/front_yard/latest.jpg?quality=80"

# Snapshot with bounding boxes for detected objects
curl -s -o /tmp/front_yard_detect.jpg \
  "http://10.10.7.55:5000/api/front_yard/latest.jpg?bbox=1"
```

### Get a Snapshot via Home Assistant

```bash
# Request HA to capture a camera snapshot
curl -s -X POST http://10.10.7.60:8123/api/services/camera/snapshot \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "camera.front_yard", "filename": "/config/www/snapshots/front_yard.jpg"}'

# Then retrieve the file via HA's static path
curl -s -o /tmp/front_yard.jpg \
  -H "Authorization: Bearer $HA_TOKEN" \
  "http://10.10.7.60:8123/local/snapshots/front_yard.jpg"
```

### Query Frigate Events

```bash
# Get recent detection events (person, car, dog, etc.)
curl -s "http://10.10.7.55:5000/api/events?limit=10" \
  | jq '.[] | {camera, label, start_time: (.start_time | todate)}'
```

### Python Snapshot Helper

```python
FRIGATE_URL = "http://10.10.7.55:5000"

def get_camera_snapshot(camera_name, bbox=False):
    """Download latest snapshot from a Frigate camera. Returns local file path."""
    from datetime import datetime
    params = {"quality": 80}
    if bbox:
        params["bbox"] = 1
    resp = requests.get(f"{FRIGATE_URL}/api/{camera_name}/latest.jpg", params=params)
    resp.raise_for_status()
    filename = f"/tmp/{camera_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    with open(filename, "wb") as f:
        f.write(resp.content)
    return filename
```

## Entity Discovery

### List All Domains in Use

```bash
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[].entity_id | split(".")[0]] | unique | sort'
```

### List Entities by Domain

```bash
# All lights with friendly names and states
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | startswith("light.")) | {id: .entity_id, name: .attributes.friendly_name, state}] | sort_by(.name)'
```

### Search Entities by Name

```bash
# Find all entities with "garage" in the name or entity_id
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id + " " + (.attributes.friendly_name // "") | test("garage"; "i")) | {entity_id, state, name: .attributes.friendly_name}]'
```

### Get Entity History

```bash
# Get state history for the last 24 hours
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://10.10.7.60:8123/api/history/period/$(date -u -v-24H +%Y-%m-%dT%H:%M:%S)?filter_entity_id=sensor.outdoor_temperature&minimal_response" \
  | jq '.[0] | length'

# Get history with timestamps
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://10.10.7.60:8123/api/history/period/$(date -u -v-1H +%Y-%m-%dT%H:%M:%S)?filter_entity_id=lock.front_door" \
  | jq '.[0][] | {state, last_changed}'
```

## WebSocket API

The WebSocket API at `ws://10.10.7.60:8123/api/websocket` provides real-time state updates and more advanced queries.

### Python WebSocket Client

```python
import asyncio, json, os, websockets

async def ha_websocket():
    """Connect, authenticate, and subscribe to state changes."""
    async with websockets.connect("ws://10.10.7.60:8123/api/websocket") as ws:
        await ws.recv()  # auth_required message
        await ws.send(json.dumps({"type": "auth", "access_token": os.environ["HA_TOKEN"]}))
        auth = json.loads(await ws.recv())
        if auth["type"] != "auth_ok":
            raise ConnectionError(f"Auth failed: {auth}")

        # Subscribe to all state changes
        await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
        await ws.recv()  # subscription confirmation

        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == "event":
                d = msg["event"]["data"]
                old = d["old_state"]["state"] if d.get("old_state") else "?"
                new = d["new_state"]["state"] if d.get("new_state") else "?"
                print(f"{d['entity_id']}: {old} -> {new}")

asyncio.run(ha_websocket())
```

### Call a Service via WebSocket

```python
# After authenticating (see above), call services with incremented msg IDs:
await ws.send(json.dumps({
    "id": 2, "type": "call_service",
    "domain": "light", "service": "turn_on",
    "service_data": {"entity_id": "light.living_room", "brightness": 200},
}))
result = json.loads(await ws.recv())
```

## MQTT Integration

For devices using MQTT directly (bypassing HA), publish commands to Mosquitto at `10.10.7.55:1883`.

```bash
# Zigbee2MQTT: turn on a device (topic pattern: zigbee2mqtt/{friendly_name}/set)
mosquitto_pub -h 10.10.7.55 -p 1883 \
  -t "zigbee2mqtt/office_light/set" \
  -m '{"state": "ON", "brightness": 200}'

# Subscribe to all Zigbee2MQTT state updates
mosquitto_sub -h 10.10.7.55 -p 1883 -t "zigbee2mqtt/+/state" -v
```

## Python Service Caller (Reusable)

```python
def call_service(domain, service, entity_id=None, **kwargs):
    """Call any HA service. Returns the response data."""
    data = {}
    if entity_id:
        data["entity_id"] = entity_id
    data.update(kwargs)
    resp = requests.post(
        f"{HA_URL}/api/services/{domain}/{service}",
        headers=HEADERS,
        json=data,
    )
    resp.raise_for_status()
    return resp.json()

# Examples — works for any domain/service combination:
call_service("light", "turn_on", "light.living_room", brightness=200)
call_service("climate", "set_temperature", "climate.living_room", temperature=72)
call_service("lock", "lock", "lock.front_door")
call_service("scene", "turn_on", "scene.movie_night")
call_service("automation", "trigger", "automation.night_mode")
```

## Error Handling

```python
def safe_ha_call(method, url, **kwargs):
    """Make an HA API call with proper error handling."""
    try:
        resp = requests.request(method, url, headers=HEADERS, timeout=10, **kwargs)
        if resp.status_code == 401:
            raise PermissionError("HA_TOKEN is invalid or expired. Regenerate at http://10.10.7.60:8123/profile/security")
        if resp.status_code == 404:
            raise LookupError(f"Entity or endpoint not found: {url}")
        if resp.status_code == 400:
            raise ValueError(f"Bad request — check entity_id and service_data: {resp.text}")
        resp.raise_for_status()
        return resp.json() if resp.text else None
    except requests.ConnectionError:
        raise ConnectionError("Cannot reach HA at 10.10.7.60:8123. Check network or HA container status.")
    except requests.Timeout:
        raise TimeoutError("HA request timed out after 10s. HA may be overloaded or restarting.")

def safe_call_service(domain, service, entity_id, **kwargs):
    """Call a service only after confirming the entity exists and is not unavailable."""
    state = get_state(entity_id)
    if state["state"] == "unavailable":
        return {"error": f"Entity {entity_id} is unavailable. Device may be offline."}
    return call_service(domain, service, entity_id, **kwargs)
```

```text
401 Unauthorized     -> Token missing/invalid. Set HA_TOKEN or regenerate at HA profile page.
404 Not Found        -> Entity ID does not exist. Use /api/states to list valid entities.
400 Bad Request      -> Service data is malformed. Check required fields for the service.
405 Method Not Found -> Wrong HTTP method. GET for states, POST for services/events.
503 Service Unavail  -> HA is restarting or an integration is failing. Check HA logs.
```

## Troubleshooting

### HA Not Responding

```bash
# Check if HA container is running, then check error log
ssh 10.10.7.60 "docker ps --filter name=homeassistant --format '{{.Status}}'"
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/error_log | tail -30
```

### Entity Unavailable

```bash
# Check state — if "unavailable", device is offline or integration needs reload
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states/light.living_room | jq '.state'

# Search for similar entity IDs if the name changed
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | contains("living")) | .entity_id]'
```

### MQTT Connection Issues

```bash
# Verify Mosquitto is reachable and check MQTT integration status in HA
nc -zv 10.10.7.55 1883
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | startswith("binary_sensor.mqtt")) | {entity_id, state}]'
```

## Tips

- Always call `/api/states/{entity_id}` before acting on a device to confirm it exists and is not `unavailable`. Controlling a missing entity returns 200 OK with no error, which silently fails.
- Brightness in the HA API is 0-255, not 0-100. Use `brightness_pct` in service_data if you want percentage-based control — HA converts it internally.
- Color temperature is in mireds (micro reciprocal degrees). Lower = cooler/bluer (153 is 6500K daylight), higher = warmer/yellower (500 is 2000K candlelight). Convert from Kelvin: `mireds = 1000000 / kelvin`.
- The REST API `/api/services` calls are fire-and-forget. They return immediately with a 200 status, but the device may take seconds to actually change. Poll the state endpoint to confirm the change took effect.
- Use `jq` filters aggressively when querying `/api/states`. The full states response can be 1MB+ on a house with 200+ entities. Filter by domain prefix to avoid parsing the entire payload.
- For Frigate snapshots, use `?quality=80` to reduce JPEG file size by ~60% with negligible visual loss. Default quality is 100 and produces 2-4MB files.
- The WebSocket API is better than REST for real-time dashboards or monitoring. REST polling more than once every 5 seconds adds unnecessary load to HA.
- MQTT topics in Zigbee2MQTT follow the pattern `zigbee2mqtt/{friendly_name}/set` for commands and `zigbee2mqtt/{friendly_name}` for state. The friendly name must match exactly, including case.
- When HA returns 401, the token is expired or wrong. Regenerate at `http://10.10.7.60:8123/profile/security` under Long-Lived Access Tokens. The `HA_TOKEN` env var must be updated in the agent's environment after regeneration.
- Automations triggered via the API respect all conditions defined in the automation. If conditions are not met, the automation runs but its actions are skipped silently. Use `automation.trigger` with `skip_condition: true` in service_data to force-run regardless.
