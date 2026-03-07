---
name: home-voice-assistant
description: Orchestrate the Jarvis kitchen voice assistant on Raspberry Pi 4 — wake word detection via openWakeWord, STT via faster-whisper, 3-tier intent classification (regex fast-path, HA API, Ollama LLM), family-aware routing, multi-timer management, TTS via openedai-speech, and 2.13" e-Paper V4 status display. Use when building the voice pipeline, configuring STT/TTS endpoints, tuning intent classification, managing the e-ink display, deploying the systemd services, or troubleshooting audio capture on EMEET USB mic/speaker.
metadata: {"clawdbot":{"emoji":"🎙️","requires":{"anyBins":["python3","pip3"]},"os":["linux","darwin"]}}
---

# Home Voice Assistant

The central orchestrator for the Jarvis kitchen voice assistant on Raspberry Pi 4. Captures audio from an EMEET USB mic (stereo, 48kHz), detects the "hey jarvis" wake word, transcribes via faster-whisper, routes through a 3-tier intent classifier (regex → HA API → Ollama LLM), and speaks a response via openedai-speech. A separate display daemon renders time, weather, calendar, and timer status on a Waveshare 2.13" e-Paper V4. All processing stays on the local network.

## When to Use

- Setting up or modifying the voice pipeline on the Pi 4
- Tuning 3-tier intent classification (adding regex patterns, adjusting HA handlers, LLM prompts)
- Configuring the Waveshare 2.13" e-Paper V4 display (layout, refresh strategy)
- Managing kitchen timers (multi-timer, named, with audio alerts)
- Configuring EMEET stereo audio capture and playback
- Deploying or updating the systemd services (voice-assistant + jarvis-display)
- Adding new Tier 2 HA integrations (calendar, shopping, meals, weather, Immich)

## Architecture

```
EMEET USB (stereo 48kHz) ─▶ PyAudio ─▶ mono downmix ─▶ openWakeWord
                                                              │ wake
                                               VAD+Record ─▶ faster-whisper(:8101)
                                                              │ text
                              ┌────── Tier 1: Regex (<100ms) ─┤
                              │       time, timer_set/query    │
                              ├────── Tier 2: HA API (<500ms) ─┤
                              │       weather, calendar, meals, │
                              │       shopping, home_control,   │
                              │       slideshow (Immich)        │
                              └────── Tier 3: Ollama (1-3s) ───┘
                                       qwen3:8b-nothink
                                              │ response
EMEET USB ◀─ stereo upmix ◀─ aplay ◀─ ffmpeg ◀─ openedai-speech(:8022)
                                              │
                              /tmp/jarvis-state.json ──▶ display_manager.py
                                                         Waveshare 2.13" V4
```

## Prerequisites

### Infrastructure Endpoints

```bash
curl -s http://10.10.7.55:8101/v1/models | python3 -m json.tool  # STT (faster-whisper)
curl -s http://10.10.7.55:8022/v1/models | python3 -m json.tool  # TTS (openedai-speech)
curl -s http://10.10.7.55:11434/api/tags | python3 -m json.tool  # LLM (Ollama qwen3:8b/14b)
curl -s -H "Authorization: Bearer $HA_TOKEN" http://10.10.7.60:8123/api/  # Home Assistant
curl -s http://10.10.7.55:9000/api/app/about | python3 -m json.tool      # Mealie
```

### Pi Setup

```bash
sudo apt-get install -y python3-pip portaudio19-dev libsndfile1 alsa-utils ffmpeg
pip install pyaudio numpy requests openwakeword webrtcvad Pillow RPi.GPIO spidev smbus2
pip install waveshare-epd  # then patch epdconfig.py (see e-Paper section)
```

### EMEET USB Audio (Stereo-Only Hardware)

```bash
# EMEET outputs 2-channel 48kHz — must capture stereo and downmix
arecord -D plughw:1,0 -f S16_LE -r 48000 -c 2 -d 5 /tmp/test-stereo.wav
# Convert to mono 16kHz for STT
ffmpeg -i /tmp/test-stereo.wav -ac 1 -ar 16000 /tmp/test-mono.wav
# Playback must be stereo
aplay -D plughw:1,0 /tmp/test-stereo.wav
```

### Configuration — `~/voice-assistant/config.json`

```json
{
  "stt": { "url": "http://10.10.7.55:8101/v1/audio/transcriptions", "model": "Systran/faster-whisper-large-v3", "language": "en" },
  "tts": { "url": "http://10.10.7.55:8022/v1/audio/speech", "model": "tts-1", "voice": "alloy", "speed": 1.0 },
  "llm": { "primary": "http://10.10.7.55:11434", "fallback": "http://10.10.7.56:11434", "intent_model": "qwen3:8b-nothink", "chat_model": "qwen3:14b" },
  "mqtt": { "broker": "10.10.7.55", "port": 1883, "topic_prefix": "voice" },
  "home_assistant": { "url": "http://10.10.7.60:8123", "token_env": "HA_TOKEN" },
  "mealie": { "url": "http://10.10.7.55:9000", "token_env": "MEALIE_TOKEN" },
  "immich": { "url": "https://photos.hotmessexpress.xyz", "token_env": "IMMICH_API_KEY", "slideshow_entity": "media_player.kitchen_display" },
  "audio": { "sample_rate": 16000, "channels": 1, "chunk_size": 1280, "device_name": "EMEET", "hw_channels": 2, "output_rate": 48000, "output_channels": 2 },
  "wake_word": { "engine": "openwakeword", "model": "hey_jarvis", "threshold": 0.5 },
  "display": { "type": "waveshare_2in13_v4", "width": 250, "height": 122, "partial_refresh_interval": 60, "full_refresh_interval": 900 },
  "ups": { "i2c_address_mcu": "0x2D", "i2c_address_ina": "0x43", "battery_type": "21700" },
  "family": {
    "default_user": "derek",
    "profiles": {
      "derek": { "calendars": ["calendar.personal", "calendar.family_shared_derek"], "name": "Derek" },
      "rachel": { "calendars": ["calendar.clinicals_rachel", "calendar.lab_rachel", "calendar.math_rachel"], "name": "Rachel" },
      "family": { "calendars": ["calendar.personal", "calendar.family_shared_derek", "calendar.clinicals_rachel", "calendar.lab_rachel", "calendar.math_rachel", "calendar.mealie_dinner"], "name": "Family" }
    }
  },
  "timers": { "max_concurrent": 5, "state_file": "/home/pi/voice-assistant/timers.json" },
  "state_file": "/tmp/jarvis-state.json"
}
```

## Audio Capture and Wake Word

EMEET hardware is stereo-only (2ch, 48kHz). Capture stereo, downmix to mono 16kHz for wake word and STT.

```python
import pyaudio, numpy as np
from openwakeword.model import Model as WakeWordModel

def find_emeet_device(pa, name="EMEET"):
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if name.lower() in info["name"].lower() and info["maxInputChannels"] > 0:
            return i, info
    raise RuntimeError(f"Audio device '{name}' not found")

def stereo_to_mono(stereo_bytes):
    """Convert 2ch interleaved int16 to mono by averaging channels."""
    stereo = np.frombuffer(stereo_bytes, dtype=np.int16).reshape(-1, 2)
    return (stereo[:, 0] / 2 + stereo[:, 1] / 2).astype(np.int16).tobytes()

# Capture at 48kHz stereo, downsample to 16kHz mono for wake word
# chunk_size=1280 at 16kHz = 80ms frames (openWakeWord expects 80ms)
```

## 3-Tier Intent Classification

The core routing logic. Utterances flow through tiers until matched.

### Tier 1 — Regex Fast Path (<100ms)

```python
import re

TIER1_PATTERNS = {
    "time": re.compile(r"\b(what time|current time|what's the time)\b", re.I),
    "timer_set": re.compile(r"\bset\s+(?:a\s+)?(?:(\w+)\s+)?timer\s+(?:for\s+)?(\d+)\s*(second|minute|hour|min|sec|hr)", re.I),
    "timer_query": re.compile(r"\b(how much time|timer status|check timer|list timer|what.*timer)\b", re.I),
    "timer_cancel": re.compile(r"\b(cancel|stop|delete|remove)\s+(?:the\s+)?(?:(\w+)\s+)?timer\b", re.I),
}

def classify_tier1(text):
    for intent, pattern in TIER1_PATTERNS.items():
        m = pattern.search(text)
        if m: return intent, m
    return None, None
```

### Tier 2 — HA/API Keyword Path (<500ms)

```python
TIER2_PATTERNS = {
    "weather": re.compile(r"\b(weather|temperature|forecast|how hot|how cold|rain|snow)\b", re.I),
    "calendar": re.compile(r"\b(calendar|schedule|event|appointment|what.*(?:today|tomorrow|this week|weekend|going on))\b", re.I),
    "shopping_add": re.compile(r"\b(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:shopping|grocery)\s*list\b", re.I),
    "shopping_query": re.compile(r"\b(?:what.*(?:shopping|grocery)|shopping\s*list|grocery\s*list)\b", re.I),
    "meal": re.compile(r"\b(dinner|lunch|breakfast|meal|recipe|what.*(?:eat|cook|for dinner|for lunch))\b", re.I),
    "home_control": re.compile(r"\b(turn|switch|toggle|dim|brighten|set|lock|unlock)\s+(?:on|off|up|down)?\s*(?:the\s+)?(.+)", re.I),
    "slideshow": re.compile(r"\b(show|display|play)\s+(?:me\s+)?(?:\w+\s+)*(?:photos?|pictures?|images?)\b", re.I),
}
```

### Tier 3 — Ollama LLM Path (1-3s)

```python
def handle_tier3(text):
    """Send to Ollama with HA context injection."""
    ha_context = get_ha_context_summary()  # sensor states, recent events
    prompt = f"""You are Jarvis, a helpful kitchen assistant for the Mattson family.
Context: {ha_context}
Answer concisely in 1-2 sentences. If an action is needed, include [ACTION:type:details].
User says: {text}"""
    resp = requests.post(f"{LLM_URL}/api/generate", json={
        "model": "qwen3:8b-nothink", "prompt": prompt, "stream": False,
        "options": {"temperature": 0.7, "num_predict": 200}
    }, timeout=30)
    return resp.json().get("response", "I'm not sure.").strip()
```

## Kitchen Timer Manager

Multi-timer system with named timers, persistence, and audio alerts via EMEET.

```python
import threading, json, os

class TimerManager:
    def __init__(self, state_file, alert_callback, max_concurrent=5):
        self.timers = {}  # name -> {"end": timestamp, "duration": seconds}
        self.state_file = state_file
        self.alert_callback = alert_callback
        self.max_concurrent = max_concurrent
        self._load_state()
        self._checker = threading.Thread(target=self._check_loop, daemon=True)
        self._checker.start()

    def set_timer(self, name, seconds):
        if len(self.timers) >= self.max_concurrent:
            return f"Maximum {self.max_concurrent} timers reached."
        self.timers[name] = {"end": time.time() + seconds, "duration": seconds}
        self._save_state()
        return f"Timer '{name}' set for {self._format_duration(seconds)}."

    def _check_loop(self):
        while True:
            now = time.time()
            expired = [n for n, t in self.timers.items() if now >= t["end"]]
            for name in expired:
                self.alert_callback(name)
                del self.timers[name]
            if expired: self._save_state()
            time.sleep(1)
```

## Family-Aware Calendar Routing

Calendar queries route to different HA calendar entities based on who's asking.

```python
def handle_calendar(text):
    """Route to correct calendars based on family profile."""
    profiles = CFG.get("family", {}).get("profiles", {})
    # Detect which profile from text
    if re.search(r"\brachel'?s?\b", text, re.I):
        cals = profiles.get("rachel", {}).get("calendars", [])
        who = "Rachel"
    elif re.search(r"\bfamily\b", text, re.I):
        cals = profiles.get("family", {}).get("calendars", [])
        who = "Family"
    else:
        cals = profiles.get("derek", {}).get("calendars", [])
        who = "Derek"

    # Fetch events from HA calendar API
    events = []
    for cal in cals:
        r = ha_get(f"/api/calendars/{cal}?start={start}&end={end}")
        if r: events.extend(r)
    events.sort(key=lambda e: e.get("start", {}).get("dateTime", ""))
    return format_calendar_response(events, who, date_label)
```

## 2.13" e-Paper V4 Display

Separate daemon (`display_manager.py`) reads `/tmp/jarvis-state.json` and renders to the Waveshare 2.13" V4 (250x122, B/W, SPI).

### Display Layout

```
┌──────────────────────────────────┐
│  10:35 AM            ~O 72F     │  ← Time (large) + weather icon + temp
│  ──────────────────────────────  │
│  Next: Soccer @ 3:30pm          │  ← Next calendar event OR voice status
│  Timer: Pasta 4:23   Batt: 87%  │  ← Active timer + UPS battery
│                      Fri Mar 06 │  ← Date (bottom-right)
└──────────────────────────────────┘
```

### Refresh Strategy

```python
PARTIAL_INTERVAL = 60   # seconds — updates time
FULL_INTERVAL = 900     # seconds — fetches weather, calendar, battery

# Force partial refresh when voice status changes (recording/thinking/speaking)
status = state.get("status", "listening")
if status in ("recording", "thinking", "speaking"):
    do_partial = True
```

### GPIO Fix for Bookworm

The waveshare_epd pip package uses gpiozero which fails on Bookworm. Patch `epdconfig.py` to use RPi.GPIO directly:

```python
# In ~/.local/lib/python3.11/site-packages/waveshare_epd/epdconfig.py
# Replace gpiozero-based RaspberryPi class with RPi.GPIO version:
class RaspberryPi:
    def __init__(self):
        import spidev, RPi.GPIO as GPIO
        self.GPIO = GPIO
        self.SPI = spidev.SpiDev()
        self.GPIO.setmode(self.GPIO.BCM)
        self.GPIO.setwarnings(False)
        self.GPIO.setup(self.RST_PIN, self.GPIO.OUT)
        self.GPIO.setup(self.DC_PIN, self.GPIO.OUT)
        self.GPIO.setup(self.CS_PIN, self.GPIO.OUT)   # Must add CS_PIN!
        self.GPIO.setup(self.PWR_PIN, self.GPIO.OUT)
        self.GPIO.setup(self.BUSY_PIN, self.GPIO.IN)
```

### UPS Battery Reading

```python
def get_battery_percent():
    """Read voltage from INA219 at I2C 0x43 on UPS HAT (D)."""
    import smbus2
    bus = smbus2.SMBus(1)
    raw = bus.read_word_data(0x43, 0x02)
    raw = ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)  # swap big-endian
    voltage = (raw >> 3) * 0.004
    bus.close()
    # 2S 21700 config: 8.4V full, 6.0V empty
    return max(0, min(100, int((voltage - 6.0) / (8.4 - 6.0) * 100)))
```

## Shared State Protocol

The voice pipeline writes state to `/tmp/jarvis-state.json`. The display daemon reads it.

```json
{
  "status": "listening",
  "timers": {"pasta": "4:23"},
  "last_question": "what time is it",
  "last_answer": "It's 1:35 PM",
  "updated_at": "2026-03-06T13:35:00"
}
```

## Systemd Services

### Voice Pipeline — `voice-assistant.service`

```ini
[Unit]
Description=Jarvis Kitchen Voice Assistant
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=pi
Group=audio
WorkingDirectory=/home/pi/voice-assistant
ExecStart=/usr/bin/python3 /home/pi/voice-assistant/jarvis.py
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=HA_URL=http://10.10.7.60:8123
Environment=HA_TOKEN=your-ha-long-lived-token
SupplementaryGroups=audio gpio spi i2c
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Display Manager — `jarvis-display.service`

```ini
[Unit]
Description=Jarvis e-Paper Display Manager
After=network-online.target voice-assistant.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/voice-assistant
ExecStart=/usr/bin/python3 /home/pi/voice-assistant/display_manager.py
Restart=on-failure
RestartSec=10
Environment=PYTHONUNBUFFERED=1
Environment=HA_URL=http://10.10.7.60:8123
Environment=HA_TOKEN=your-ha-long-lived-token
SupplementaryGroups=gpio spi i2c
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now voice-assistant jarvis-display
journalctl -u voice-assistant -f --no-pager
journalctl -u jarvis-display -f --no-pager
```

## Text-to-Speech and Playback

EMEET requires stereo output. TTS returns mono WAV — use ffmpeg to upmix before aplay.

```python
def speak(text):
    """Generate TTS and play through EMEET (stereo upmix via ffmpeg)."""
    resp = requests.post(TTS_URL, json={
        "model": "tts-1", "input": text, "voice": VOICE, "response_format": "wav"
    }, timeout=30)
    wav_path = "/tmp/jarvis-tts.wav"
    with open(wav_path, "wb") as f:
        f.write(resp.content)
    # ffmpeg converts to stereo 48kHz, aplay sends to EMEET
    os.system(f"ffmpeg -y -i {wav_path} -ac 2 -ar 48000 /tmp/jarvis-play.wav 2>/dev/null")
    os.system("aplay -D plughw:1,0 /tmp/jarvis-play.wav 2>/dev/null")
```

## Troubleshooting

```bash
# No audio — verify EMEET USB
lsusb | grep -i emeet && arecord -l
# Must be in audio group
sudo usermod -aG audio,gpio,spi,i2c pi

# STT returns empty
curl -v http://10.10.7.55:8101/v1/audio/transcriptions \
  -F "file=@/tmp/test.wav" -F "model=Systran/faster-whisper-large-v3"

# e-Paper GPIO error — verify patched epdconfig.py
python3 -c "from waveshare_epd import epd2in13_V4; e = epd2in13_V4.EPD(); e.init(); e.Clear(0xFF); e.sleep()"

# Ollama slow — warm up model
curl -s http://10.10.7.55:11434/api/generate \
  -d '{"model":"qwen3:8b-nothink","prompt":"hi","stream":false}' > /dev/null

# Display not updating — check state file
cat /tmp/jarvis-state.json | python3 -m json.tool
```

## Tips

- Use `qwen3:8b-nothink` (not `qwen3:8b`) for intent classification — the "nothink" variant skips chain-of-thought reasoning, shaving 1-2 seconds off response time.
- Tier 1 regex handles ~40% of kitchen queries (time, timers). This keeps the assistant feeling snappy for the most common asks.
- The EMEET captures 2-channel 48kHz audio. You must downmix to mono 16kHz before sending to openWakeWord or faster-whisper. Forgetting this causes silent failures.
- Set wake word threshold to 0.5 initially. Raise to 0.65 for fewer false triggers from TV audio bleed.
- The e-Paper display uses partial refresh for time updates (60s) and full refresh for weather/calendar (15min). Never refresh during voice interaction — e-ink refreshes take 2-3 seconds and block the SPI bus.
- Timer alerts play a chime via EMEET + TTS announcement ("Pasta timer is done!"). The chime is generated once as a WAV and cached.
- If the EMEET mic picks up TTS playback and re-triggers wake word, the `is_speaking` flag suppresses wake detection during playback.
- The GPIO patch for Bookworm is critical — the stock waveshare_epd uses gpiozero which fails with "Failed to add edge detection" on GPIO24 (BUSY pin). The RPi.GPIO direct approach avoids this entirely.
- UPS HAT (D) uses pogo pins underneath the Pi, leaving the GPIO header free for the e-Paper HAT. I2C addresses: 0x2D (MCU), 0x43 (INA219).
- Keep TTS responses under 2 sentences. For complex answers, say a summary and show full text on the e-ink display.
