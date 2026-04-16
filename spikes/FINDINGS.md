# Spike Findings — April 14, 2026

Target account: `@houseofyesnyc` (Brooklyn arts/nightlife venue). Playwright 1.44, Chromium headless-shell 147.

## Spike 1 — Login / session persistence

- **Headed login → headless re-verification worked first try.** 9 cookies saved to `~/.radar/session.json`, headless context loaded `instagram.com` without redirect to `/accounts/login/`.
- No 2FA prompt surfaced during this run (account-dependent — must re-test on an account that has 2FA on).
- No interstitial ("save login info" / "turn on notifications") fired this run. The `Not Now` dismiss path in [01-login.mjs:70](spikes/01-login.mjs#L70) is untested against them.
- **`isLoggedIn` heuristic (`nav` count + `/accounts/login` redirect check) was sufficient.** Cleaner than looking for a specific nav item.

**Decision for M2:** headed-only for the initial `radar auth login`, headless for scans. Match the spike's exact flow.

---

## Spike 2 — Story iteration

- **Headless works.** Did not need to fall back to headed mode. 5 frames captured, video frame paused successfully via `v.pause(); v.currentTime = 0`.
- **Frame IDs come from the URL path: `/stories/<user>/<mediaId>/`.** Frames 2–5 had a stable numeric `mediaId` (e.g. `3875250248382047188`). **Frame 1 does not** — it lands on `/stories/<user>/` before the first mediaId is pushed into the URL.
- **Fallback ID for frame 1:** the `<time datetime="…">` element gives a precise timestamp (e.g. `2026-04-14T16:52:51.000Z`). Use `sha256(account + ":" + datetime)` when URL mediaId is absent. No need to hash image blobs.
- **End-of-story detection** — advancing past the last frame navigates out of `/stories/`. Checking `page.url().includes('/stories/')` after `ArrowRight` is reliable.
- **`aria-label="Next"` button is present** on the header — could be used instead of keyboard advance if keyboard input breaks in future IG releases.
- **No frame was a carousel/multi-media in this run.** Phase 2 consideration: multi-image story frames may need extra handling; out of scope for M5.

**Decisions for M5:**
- **Headless is the default.** §8's "headed fallback" becomes a single retry path for selector timeouts, not a mode flag.
- `source_id` schema deviation from SPEC §6: add `source_id_kind TEXT` column to `seen` and `events` — values `"url_mediaid" | "time_hash"`. Small but explicit.
- Use `ArrowRight` with `aria-label="Next"` as a backup click target.
- Store `story_taken_at` (from `<time datetime>`) on every row so we can debug ID collisions later.

---

## Spike 3 — Post grid

First run returned 0 entries (grid lazy-loads). Added a `waitForSelector` — second run returned 12 entries cleanly.

- **Grid anchors are `a[href*="/p/"]` and `a[href*="/reel/"]`.** Shortcodes are stable and match `/<owner>/p/<shortcode>/`.
- **Critical finding — grid includes posts from OTHER accounts that tagged `@houseofyesnyc`.** Of 12 grid entries, 3 belonged to other accounts (`/revivalhouseproject/p/…`, `/pinkmammothsf/reel/…`, `/tikidisco/p/…`). The grid `readGrid()` captures the "posts featuring this account," not just owned posts. **Radar must filter `href.startsWith('/<username>/')` to only process owned posts** — otherwise it double-counts events that a venue + a collaborator both tagged. Alternatively: treat tagged posts as a cheap cross-signal for Phase 4's "same event posted by venue + promoter" dedup.
- **Bigger finding — grid tile `alt` text contains the full caption (for posts, not for all reels).** Example: post `DW7ETuQGNe5` alt = *"F*ck a fire horse - it's the year of the fire RAM 🔥🐏 … This Saturday, April 11th with @mbootyspoon @djharam and @mikesimonetti"*. This means **Radar likely doesn't need to open each post** to read caption text — it can send `(grid tile screenshot, alt text as caption)` directly to Claude Vision. Massive speed win: ~1 request per post instead of 2 round-trips.
- **IG auto-alt reads text off event posters.** Example: `"May be an image of poster and text that says 'TIKI DISCO … HOUSE OF YES … SUNDAY 28TH JUNE … INDUSTRY CITY, BROOKLYN'"`. This is ~free pre-OCR and can feed into Vision as additional signal.
- **Reels are ~half the grid for this account.** SPEC §2 excludes reels from v1. Filter `kind === 'post'` during scan.
- **Opening the post detail page does give `<time datetime>` (ISO 8601).** But if we're going caption-from-alt we may only open posts when the alt is empty.
- **Caption selector inside the post modal didn't match.** `h1` and the role=button span selectors returned empty. Not a blocker for v1 if we use grid alt instead; flag for Phase 2 if grid alt ever turns out to be truncated.
- **Profile requires login to see the grid in headless.** With a logged-out context, IG served a login wall — try this yourself by deleting `session.json`. Login is non-negotiable.

**Decisions for Phase 2 (`radar scan --posts`):**
- **Fetch strategy:** read the grid with `waitForSelector('a[href*="/p/"]')` + 1.5s settle, filter `kind === 'post'`, filter `href.startsWith('/<username>/')`, keep the top 12 owned posts. Dedup via `seen` table using the shortcode as `source_id`.
- **Skip opening post detail pages for v1.** Use grid tile screenshot + `alt` text as Vision inputs. Only open the detail page if alt is missing AND the post is under 3 days old.
- **Drop the composite-screenshot idea from SPEC §7** — Vision takes image + text blocks natively; no stitcher needed. (Already flagged in my review.)

---

## Spec updates required

1. **SPEC §6 `seen` / `events` schema** — add `source_id_kind` and `story_taken_at` columns. Or encode in `source_id` prefix (`url:3875…` vs `hash:abc…`). I'd prefer the explicit column.
2. **SPEC §7 "composite screenshot" for posts** — remove. Send image + alt text separately.
3. **SPEC §7 story strategy** — note that frame 1 lacks a mediaId and uses the `<time datetime>` fallback.
4. **SPEC §8 headless-vs-headed** — default headless is confirmed viable for this target. Keep headed only for `auth login`.
5. **SPEC — new constraint** — grid tiles include tagged-but-not-owned posts. Must filter by owner prefix. Phase 4 note: tagged posts are a candidate signal for cross-account duplicate detection.
6. **SPEC §2 "5-minute for 20–30 accounts" scan budget** — still too optimistic; hold at 8–10 min as the realistic target until measured.

---

## Raw outputs

- [spikes/out/2026-04-14T22-47-36-649Z-story-houseofyesnyc-headless/](out/2026-04-14T22-47-36-649Z-story-houseofyesnyc-headless/)
- [spikes/out/2026-04-14T22-48-52-338Z-posts-houseofyesnyc/](out/2026-04-14T22-48-52-338Z-posts-houseofyesnyc/)

Session file: `~/.radar/session.json` (9 cookies, captured April 14, 2026). Valid until IG expires it or we log out.
