# Spikes

Throwaway scripts to de-risk Instagram DOM + Playwright unknowns before committing to an architecture. **None of this code ships.** Findings get written up and the scripts get deleted.

## What we're trying to learn

1. **Login flow** — can we produce a working `storageState` that survives 2FA and "save login info" prompts? (`01-login.mjs`)
2. **Story iteration** — can Playwright open the story viewer, advance frames, and screenshot each one? Does it work headless, or is headed required? How do we get a stable per-frame ID? (`02-story-scan.mjs`)
3. **Post grid** — what's exposed on a profile grid for dedup (post shortcodes, timestamps)? (`03-post-grid.mjs`)

## Run order

```bash
npm install
npm run install-browsers

# 1. Log in once, save session
npm run spike:login

# 2. Poke at a target account's stories
npm run spike:story -- <username>

# 3. Look at their post grid
npm run spike:posts -- <username>
```

Session is stored at `~/.radar/session.json`. Per-run output (screenshots, DOM dumps, logs) goes under `spikes/out/<timestamp>/`.

## Report template — fill this in after running

- Does headless work for stories? _yes / no / partial_
- Story frame ID source: _url mediaId / DOM attr / synthesized_
- Number of frames reliably captured on a multi-frame story: _n / total_
- Post grid shortcode + timestamp available without opening each post? _yes / no_
- Login hit 2FA / suspicious login / save-info prompt? How did storageState survive?
- Any selectors that looked unstable (class-name-only, no aria)?
