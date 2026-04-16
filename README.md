# Radar

Scans Instagram accounts for upcoming arts and music events, extracts structured event data with Claude Vision, and surfaces everything in a local web UI.

Runs entirely on your machine. Your API key, Instagram session, and scraped data never leave your laptop.

## Quick start

```bash
git clone https://github.com/<your-fork>/Radar.git
cd Radar
npm install
npm start
```

`npm install` pulls dependencies and downloads the Playwright Chromium binary (~200 MB, one-time). `npm start` launches the UI and opens `http://localhost:4510` in your browser.

## First run

The UI shows a three-step setup banner at the top. Click each step; it opens the right input and checks off when complete.

1. **Add a vision API key.** Radar supports Claude (Anthropic) and Gemini (Google). Pick either — you can swap anytime. Get a key at [console.anthropic.com](https://console.anthropic.com) or [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Saved to `./.env` (gitignored).
2. **Log into Instagram.** A Chromium window opens — log in manually. Your session cookies are saved to `~/.radar/session.json` (gitignored).
3. **Add accounts to track.** Paste a handle (e.g. `elsewherespace`), pick a tag, hit Add. Repeat for each venue/artist you want to follow.

Hit **Scan now**. On the first scan with 5–10 accounts, expect roughly 5–15 minutes. Events appear with thumbnails as they're found.

## Requirements

- Node.js 20+
- A Claude (Anthropic) **or** Gemini (Google) API key with credits
- An Instagram account (a throwaway is fine — session cookies stay local)

### Which model to use?

- **Claude Sonnet 4.5** (default): higher precision on nuanced classification, stronger JSON reliability historically, more expensive. Good default.
- **Gemini 2.5 Flash**: ~10× cheaper per scan, 2× faster, native structured output, strong OCR on flyer text. A good pick for high-volume scanning.

Toggle the provider from the Settings modal at any time. Keys for both are stored independently so you can switch without re-entering anything.

## Commands

The UI covers everything, but a CLI is also available:

```bash
npm run radar -- scan                    # scan all tracked accounts
npm run radar -- scan --account <handle> # scan one account, verbose
npm run radar -- accounts list
npm run radar -- accounts add <handle> --tag venue
npm run radar -- events                  # print upcoming events
npm run radar -- digest --save           # save a Markdown digest
npm run radar -- auth login              # re-authenticate Instagram
npm run radar -- ui --port 4510          # start the UI on a custom port
```

Valid account tags: `venue`, `music`, `art`, `promoter`, `gallery`, `festival`, `collective`. They're passed to Claude Vision as context when classifying posts.

## Where data lives

| File | What |
|---|---|
| `./.env` | Anthropic API key |
| `~/.radar/accounts.json` | Accounts you track |
| `~/.radar/session.json` | Instagram session cookies |
| `~/.radar/radar.db` | SQLite database: events, dedup state, scan history |
| `./screenshots/YYYY-MM-DD/<account>/*.png` | Captured post and story frames |

Override the screenshot location with `RADAR_SCREENSHOT_DIR`.

## Configuration

Environment variables (in `./.env`):

```
RADAR_VISION_PROVIDER=claude              # claude | gemini
ANTHROPIC_API_KEY=sk-ant-...              # required when provider=claude
ANTHROPIC_MODEL=claude-sonnet-4-5         # optional
GOOGLE_API_KEY=AIza...                    # required when provider=gemini
GEMINI_MODEL=gemini-2.5-flash             # optional
RADAR_SCREENSHOT_DIR=./screenshots        # optional
```

## Publishing to a public calendar (optional)

Radar can automatically publish your upcoming events (plus their flyer screenshots) to a **Cloudflare R2** bucket after every scan. Pair with the companion static viewer — [radar-calendar](https://github.com/<your-fork>/radar-calendar) — deployed as a Cloudflare Pages site — to give yourself and your friends a shareable, filterable calendar at a URL like `your-calendar.pages.dev`.

Setup is optional and one-time. The quick version:

1. Create a free [Cloudflare](https://dash.cloudflare.com) account.
2. R2 → create a bucket → enable its public `.r2.dev` subdomain → add a CORS policy (`AllowedOrigins: ["*"]`, `AllowedMethods: ["GET"]`).
3. Create an R2 API token with Object Read & Write scoped to that bucket.
4. Copy the token values into `./.env` under `R2_*` (see `.env.example`).
5. Fork `radar-calendar`, edit `config.js` with your R2 public URL, deploy it to Cloudflare Pages (build command: none, output: `/`).

After that, every `radar scan` (CLI or UI) ends with a silent publish step. If any `R2_*` var is missing, publishing is skipped and scans work normally.

See `radar-calendar`'s README for the viewer setup details.

## Privacy and safety

- Everything runs locally. The only external calls are to Instagram (to load pages) and Anthropic (for Vision extraction). Nothing is uploaded to Radar servers — there are none.
- Your API key, session cookies, and all scraped data are gitignored and never leave your machine.
- Instagram's terms of service prohibit automated scraping. Scanning too aggressively can get your account rate-limited or banned. Radar inserts 3–7 second delays between accounts and scans only the first 5 grid posts per account to stay conservative. Use a throwaway account you don't mind losing, and don't set up aggressive automated schedules.
- Claude Vision costs roughly $0.50–1.00 per full scan of 10 accounts. Monitor usage at [console.anthropic.com](https://console.anthropic.com).

## How it works

1. For each tracked account, Playwright opens the profile and captures screenshots of recent stories and the top posts.
2. Each screenshot is sent to Claude Vision with a prompt that asks whether it's an upcoming event and, if so, to extract `{name, date, time, venue, description, ticket_url, confidence}` as JSON.
3. Classified events are stored in SQLite. A `seen` table dedups across scans so re-scanning is cheap.
4. The UI reads the DB and renders events grouped by date, filtered by account and date range, with thumbnails of the source screenshots.

Code layout:

```
bin/radar.js              CLI entry point
src/cli/                  CLI commands
src/scanner/              Playwright scraping (stories, posts, browser, screenshot)
src/vision/               Claude Vision prompt + extract
src/db/                   SQLite schema and CRUD
src/ui/                   Local web server + static frontend
```

## License

Personal use. No warranty. Don't do anything with this you wouldn't want a venue owner to see you doing.
