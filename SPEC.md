# Radar — Product & Design Spec
**Instagram Arts & Music Event Scanner**
Version 1.1

---

## 1. Overview

Radar is a local CLI tool that scans Instagram stories and posts from a curated list of followed accounts, detects arts and music events using Claude Vision, and produces a clean digest of upcoming things to do. It is designed to be shareable among friends — each person runs it locally with their own Instagram session, and account lists can be shared as plain config files.

### The problem

Arts and music venues, promoters, and collectives post heavily on Instagram — but the feed algorithm buries event posts, and stories disappear within 24 hours. Keeping track of what's happening requires constantly checking multiple accounts manually, and it's easy to miss things.

### The solution

Radar automates this. Given a list of accounts you care about, it opens a real browser session, scrolls through stories and recent posts, screenshots anything that looks like an event announcement, sends those screenshots to Claude Vision for structured extraction, and outputs a dated digest of upcoming events — with zero missed stories and no algorithmic noise.

---

## 2. Goals

- Detect arts and music event announcements from Instagram stories and feed posts
- Work with any public or followed Instagram account
- Surface only *new* content since the last scan (no duplicates)
- Produce a readable digest (terminal output + saved markdown file)
- Be installable and runnable by non-technical friends with minimal setup
- Be fast enough that a full scan of 20–30 accounts completes in under ~10 minutes

## Non-goals (v1)

- No hosted version or shared backend — everything runs locally
- No automatic scheduling — all scans are triggered manually
- No push notifications or email delivery
- No support for private accounts the user doesn't already follow
- No support for Reels (v1 focuses on stories and feed posts only)

---

## 3. Users

**Primary user: you.** Runs the tool regularly, maintains the account list, and shares configs with friends.

**Secondary users: your friends.** Install the tool, drop in a shared `accounts.json`, enter their own Instagram credentials, and run scans independently. They may or may not be technical.

Both groups share the same tool and the same config format — the only thing that differs is their Instagram session.

---

## 4. Core Concepts

### Account list
A JSON file (`accounts.json`) listing the Instagram usernames to scan. This file is the sharable unit — a friend who wants the same event coverage just uses the same file. Accounts are tagged by category to help Claude filter.

### Scan
A single run of Radar against the full account list. A scan visits each account, checks for new stories and recent posts, screenshots relevant frames, and sends them to Claude Vision.

### Seen-state
A local SQLite database (`radar.db`) that tracks every post ID and story ID already processed. On each scan, any content already in the seen-state is skipped. This prevents duplicate events across scans.

### Event
A structured record extracted by Claude Vision from a screenshot. Contains: event name, date/time, venue, a short description, the source account, the source URL (if available), and the screenshot path.

### Digest
A formatted output — shown in the terminal and saved as a markdown file — listing all events found in a scan, grouped by date.

---

## 5. CLI Interface

Radar is invoked from the terminal. Commands follow the pattern `radar <command> [options]`.

### Commands

```
radar scan               Run a full scan of all accounts
radar scan --stories     Scan stories only
radar scan --posts       Scan feed posts only
radar scan --account @handle   Scan a single account

radar accounts           List all tracked accounts
radar accounts add @handle [--tag music|art|venue|promoter]
radar accounts remove @handle
radar accounts import ./accounts.json

radar events             Show all extracted events
radar events --upcoming  Show only future events (default)
radar events --all       Show all events including past
radar events --since 7d  Show events found in the last 7 days

radar digest             Print the latest digest to terminal
radar digest --save      Save digest to ./digests/YYYY-MM-DD.md
radar digest --format text|markdown

radar auth login         Open browser to log in and save session
radar auth status        Check if the current session is valid
radar auth logout        Clear the saved session

radar config             Show current config
radar config set [key] [value]
```

### Terminal output during a scan

```
$ radar scan

  Radar — scanning 24 accounts

  Stories
  ────────────────────────────────────────
  ✓  @the_crocodile          2 stories   1 event found
  ✓  @neumos                 4 stories   2 events found
  ✓  @seattleartmuseum       1 story     no events
  –  @bumbershoot            no stories
  ✓  @subpop                 3 stories   1 event found
  ... (19 more)

  Feed posts
  ────────────────────────────────────────
  ✓  @the_crocodile          6 posts     1 new event
  ✓  @chophouseseattle       3 posts     no events
  ... (22 more)

  ────────────────────────────────────────
  Scan complete  ·  4m 12s
  8 events found  ·  digest saved → digests/2025-04-14.md
```

### Digest output format (terminal + markdown)

```
  RADAR DIGEST — Monday, April 14 2025
  ════════════════════════════════════

  THIS WEEK
  ─────────

  Thursday Apr 17
    ROAD TRIP with Glass Beams + Deeper
    Neumos · 9pm · $20
    Tickets: tix.com/…
    via @neumos (story)

  Friday Apr 18
    Soft Opening: New Works by Mia Lior
    Vermillion Art Gallery · 7–10pm · Free
    via @vermillion_seattle (post)

  Saturday Apr 19
    Sub Pop 35th Anniversary Block Party
    Capitol Hill · 2pm · Free w/ RSVP
    Tickets: subpop.com/…
    via @subpop (story)

  NEXT WEEK
  ─────────

  Wednesday Apr 23
    Black Belt Eagle Scout Album Release
    The Crocodile · 8pm · $18
    via @the_crocodile (post)

  ─────────────────────────────────────
  8 events  ·  scanned 24 accounts  ·  Apr 14 10:42am
```

---

## 6. Data Model

### `accounts.json` (shareable config)

```json
{
  "version": 1,
  "accounts": [
    {
      "username": "neumos",
      "tag": "venue",
      "active": true,
      "added": "2025-04-01"
    },
    {
      "username": "subpop",
      "tag": "music",
      "active": true,
      "added": "2025-04-01"
    },
    {
      "username": "seattleartmuseum",
      "tag": "art",
      "active": true,
      "added": "2025-04-01"
    }
  ]
}
```

**Tags:** `venue`, `music`, `art`, `promoter`, `gallery`, `festival`, `collective`
Tags help tune the Claude Vision prompt — a `venue` post is almost always an event; a `music` label account may post non-event content more often.

### `radar.db` — SQLite schema

**events**
```
id              TEXT PRIMARY KEY   -- sha256(account + source_id + event_name)
account         TEXT
source_type     TEXT               -- "story" | "post"
source_id       TEXT               -- see source_id_kind
source_id_kind  TEXT               -- "url_mediaid" | "time_hash" | "shortcode"
story_taken_at  TEXT               -- ISO 8601 from <time datetime>, null for posts
event_name      TEXT
event_date      TEXT               -- ISO 8601 or raw string if unparseable
event_time      TEXT
venue           TEXT
description     TEXT
ticket_url      TEXT
screenshot_path TEXT
raw_response    TEXT               -- full Claude JSON response
found_at        TEXT               -- ISO 8601 scan timestamp
```

**seen**
```
source_id       TEXT PRIMARY KEY   -- see source_id_kind
source_id_kind  TEXT               -- "url_mediaid" | "time_hash" | "shortcode"
account         TEXT
source_type     TEXT
story_taken_at  TEXT               -- ISO 8601, null for posts
scanned_at      TEXT
was_event       INTEGER            -- 0 or 1
error           TEXT               -- nullable; Vision failure message for replay
```

**`source_id` derivation:**
- Posts: `shortcode` from the grid href `/<owner>/p/<shortcode>/`.
- Stories frames 2+: the URL mediaId from `/stories/<user>/<mediaId>/`.
- Stories frame 1 (no URL mediaId yet): `sha256(account + ":" + story_taken_at)` where `story_taken_at` comes from the `<time datetime>` element on the frame.

**scans**
```
id              TEXT PRIMARY KEY
started_at      TEXT
completed_at    TEXT
accounts_scanned INTEGER
events_found    INTEGER
```

---

## 7. Claude Vision Integration

### The extraction prompt

Each screenshot is sent to Claude with the following system + user prompt:

**System:**
> You are an event extraction assistant for a tool that scans Instagram for arts and music events in Seattle. You receive screenshots of Instagram posts and stories. Your job is to determine if the content advertises a specific upcoming event, and if so, extract structured information from it.
>
> An "event" means: a concert, show, DJ set, gallery opening, art exhibition, open mic, festival, block party, film screening, performance, or similar time-bound happening with a specific date.
>
> Things that are NOT events: general promotional posts, merch drops, album announcements without show dates, recaps of past events, artist spotlights without a date.

**User:**
> This screenshot is from the Instagram {source_type} of @{username}, tagged as a {tag} account.
>
> Is this an upcoming event announcement? Respond only in JSON.
>
> If YES:
> ```json
> {
>   "event": true,
>   "name": "Event name",
>   "date": "Day Month Year or null",
>   "time": "Time or null",
>   "venue": "Venue name and/or address or null",
>   "description": "One sentence summary",
>   "ticket_url": "URL if visible or null",
>   "confidence": "high | medium | low"
> }
> ```
>
> If NO:
> ```json
> { "event": false }
> ```

### Confidence handling

- `high` — clear event poster with name, date, venue visible
- `medium` — likely an event but some details are cut off or unclear
- `low` — possible event mention but ambiguous (e.g. a flyer partially visible in a story)

In v1, all confidence levels are saved. The digest shows `medium` and `high` by default; `low` confidence events are stored but not shown unless `--all` is passed.

### Screenshot strategy for stories

Stories are ephemeral and often multi-frame. The scanner will:
1. Navigate directly to `https://www.instagram.com/stories/<user>/` (works headless with a logged-in session; no story-ring click required)
2. Screenshot the current frame
3. Read `<time datetime>` on the frame to record `story_taken_at`
4. Advance with `ArrowRight` (fallback: click the `aria-label="Next"` button)
5. Repeat until advancing navigates out of `/stories/`, capped at 15 frames per story as a safety

Story frames with video will be paused (`video.pause(); video.currentTime = 0`) before screenshotting. Audio is ignored. Frame IDs are derived from the URL path when available (`/stories/<user>/<mediaId>/`); the first frame's URL has no mediaId, so the ID is synthesized from `story_taken_at` (see §6).

### Screenshot strategy for posts

For feed posts, the scanner visits `https://www.instagram.com/<user>/`, waits for `a[href*="/p/"]` to render (grid tiles are lazy-loaded), and reads the top 12 anchors. Each anchor's `alt` attribute contains the full caption, including Instagram's auto-OCR of any poster text in the image — this eliminates the need to open each post just to read its caption.

For each grid tile the scanner will:
1. Filter `kind === 'post'` (v1 excludes reels — see §2)
2. Filter `href.startsWith('/<username>/')` — the grid also surfaces posts from *other* accounts that tagged this user. Without this filter, events get double-counted when a venue + a promoter both tag the same post. (Phase 4 may re-use tagged posts as a cross-account dedup signal.)
3. Dedup against the `seen` table by `shortcode`
4. Screenshot the grid tile
5. Send `(tile screenshot, alt text)` to Claude Vision as separate image + text blocks — not a composite PNG

The post detail page (`/<user>/p/<shortcode>/`) is only opened as a fallback when the tile `alt` is empty.

---

## 8. Browser Automation Design

**Tool:** Playwright with Chromium.

**Session management:** On first run, `radar auth login` opens a visible (non-headless) Chromium window for the user to log in manually (including 2FA). The `storageState` is saved to `~/.radar/session.json` and all subsequent scans run headless against that state. If the session expires, the scanner detects the redirect to `/accounts/login/` and prompts the user to re-authenticate. `radar auth status` is implemented by opening a headless context against the saved state and checking for the login redirect.

**Rate limiting:** To avoid Instagram bot detection, the scanner:
- Adds random delays between account visits (3–7 seconds)
- Adds random delays between story frame advances (1–3 seconds)
- Does not parallelize account visits — all scans are sequential
- Uses Playwright's default Chromium user-agent

**Headless is the default for all scanning.** The spike against `@houseofyesnyc` confirmed that stories can be opened via direct navigation to `/stories/<user>/` without clicking the story ring, and the post grid renders reliably after a `waitForSelector('a[href*="/p/"]')`. Headed mode is only used for the initial `auth login` flow. If a headless scan fails on a given account (story viewer refuses to open, grid never renders), the scanner logs the failure and moves on rather than falling back to headed — keeping the scan automated.

---

## 9. File & Folder Structure

```
radar/
├── bin/
│   └── radar.js              # CLI entry point
├── src/
│   ├── scanner/
│   │   ├── browser.js        # Playwright session management
│   │   ├── stories.js        # Story scanning logic
│   │   ├── posts.js          # Feed post scanning logic
│   │   └── screenshot.js     # Screenshot capture utilities
│   ├── vision/
│   │   ├── extract.js        # Claude Vision API calls
│   │   └── prompt.js         # Prompt templates
│   ├── db/
│   │   ├── schema.js         # SQLite schema setup
│   │   ├── events.js         # Event CRUD
│   │   └── seen.js           # Seen-state tracking
│   ├── digest/
│   │   ├── format.js         # Terminal + markdown formatting
│   │   └── group.js          # Group events by date
│   └── cli/
│       ├── commands/         # One file per command
│       └── output.js         # Shared terminal formatting
├── accounts.json             # Tracked accounts (shareable)
├── digests/                  # Saved digest files
│   └── 2025-04-14.md
├── screenshots/              # Raw screenshots from scans
│   └── 2025-04-14/
├── radar.db                  # SQLite database (local only)
├── .radar/
│   └── session.json          # Instagram session (gitignored)
├── package.json
├── README.md
└── .gitignore                # Excludes session.json, radar.db, screenshots/
```

---

## 10. Setup & Sharing Flow

### First-time setup (new user)

```bash
# 1. Clone or download
git clone https://github.com/you/radar && cd radar

# 2. Install dependencies
npm install
npm run install-browsers   # installs Playwright's Chromium

# 3. Add Anthropic API key
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 4. Log in to Instagram
radar auth login           # opens browser window, user logs in manually

# 5. Add accounts (or import a shared file)
radar accounts import ./accounts.json

# 6. Run first scan
radar scan
```

### Sharing with a friend

The shareable artifact is just `accounts.json`. A friend who wants the same coverage:
1. Does steps 1–4 above
2. Receives your `accounts.json` (Slack, AirDrop, email — anything)
3. Runs `radar accounts import ./accounts.json`
4. Runs `radar scan`

Nothing about their Instagram session, database, or API key is shared.

---

## 11. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20+ | Native ESM, good Playwright support |
| CLI framework | `commander.js` | Lightweight, widely used |
| Browser automation | `playwright` | Reliable story navigation, session persistence |
| AI vision | Anthropic Claude (`claude-sonnet-4-5`) | Best-in-class visual extraction |
| Database | `better-sqlite3` | Zero-config, ships as a file |
| Terminal output | `chalk` + `cli-table3` | Clean formatting without heavy deps |
| Config | JSON files | Human-readable, easily shareable |

---

## 12. Build Phases

### Phase 1 — Core scanner (MVP)
- `radar auth login / logout / status`
- `radar accounts add / remove / list`
- Story scanning with screenshot capture
- Claude Vision extraction + events DB
- `radar scan` command with terminal output
- Seen-state deduplication

### Phase 2 — Feed posts + digest
- Feed post scanning
- `radar events` command
- `radar digest` with markdown output
- `--save` flag for digest files

### Phase 3 — Polish & sharing
- `radar accounts import / export`
- Confidence filtering in digest
- Better error handling (session expiry, rate limits, partial failures)
- README for non-technical friends

### Phase 4 — Nice to haves (post-v1)
- `--since` and `--until` date filters
- Carousel post support (multiple images per post)
- Duplicate event detection across accounts (same event posted by venue + promoter)
- Weekly digest email via `nodemailer`

---

## 13. Key Risks & Mitigations

**Instagram bot detection**
Playwright using a real browser with human-like delays significantly reduces detection risk compared to API scraping. The tool operates on the user's own session (logged-in), which is the same as a user manually browsing. Mitigation: random delays, sequential (not parallel) scanning, headed fallback for stories.

**Story timing**
Stories expire after 24 hours. A user who doesn't run Radar for 2+ days will miss stories. Mitigation: document this clearly; in a future version, add optional scheduled scans.

**Claude Vision accuracy**
Some event posters are stylized and hard to parse (hand-drawn type, dark backgrounds). Mitigation: confidence scoring, saving all screenshots for manual review, easy re-scan of individual accounts.

**Instagram UI changes**
Playwright selectors break when Instagram updates its DOM. Mitigation: use semantic selectors (aria labels, role attributes) over CSS class selectors where possible. Pin Playwright version and test on updates.

---

*Spec v1.1 — April 14, 2026. Updated post-spike: schema additions (`source_id_kind`, `story_taken_at`, `error`), headless-default scanning, drop composite-screenshot, grid-owner filter, revised 10min scan budget. This is a living document — update version and date on any structural changes.*
