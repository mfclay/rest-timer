# Rest Timer — Project Notes

A single-file workout rest timer for strength training. Everything lives in `index.html`: HTML, CSS, JS, and persistent state in `localStorage`. No build step, no server, no dependencies beyond Google Fonts (Inter + JetBrains Mono).

Open the file directly in a browser to use it, or visit the hosted version at https://mfclay.github.io/rest-timer/

---

## What it does

You pick an exercise, weight, and reps. You hit space to start lifting. You hit space again when you finish the set — the timer flips to a green rest countdown. You hit space when you're ready for your next set. Repeat. Pause/discard/edit are available throughout.

The point of the rest timer is to give you a **target rest duration per exercise** (e.g. 3 min for squat, 2 min for bench) and visual/audio cues as you approach it, hit it, or blow past it. The app tracks every set of every session and saves history.

---

## State machine

Three modes drive nearly every visual change in the app:

| Mode | Trigger | Timer shows | Primary button | What's logged |
|---|---|---|---|---|
| `ready` | App load, end of session | `00:00` (white) | "Begin session" | nothing |
| `lifting` | Press space from `ready` or `resting` | Counts up (white) | "Done — start rest" | nothing yet |
| `resting` | Press space from `lifting` | Counts up (green/amber/red as it crosses thresholds) | "Start next set" | the set that just finished |

Set objects are pushed to `STATE.setsThisSession` when `lifting → resting` happens. The `restAfter` field on that set is filled in later when `resting → lifting` happens.

```js
{
  setNum: 3,
  exercise: 'Squat',
  weight: 225,
  reps: 5,
  liftDuration: 18,    // seconds
  restAfter: 174,      // seconds, filled in when next set starts
  timestamp: 1715000000000,
}
```

The session itself is committed to history when the user ends it (red "End session" button, top right).

---

## Layout (the main view)

```
┌─────────────────────────────────────────────────────┐
│ Header: session name | elapsed | set #     [btns]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────┐                                            │
│  │SET 1│       STATE LABEL                          │
│  │squat│                                            │
│  └─────┘                                            │
│  ┌─────┐         02:15                              │
│  │SET 2│                                            │
│  └─────┘    Target: 03:00 · Last rest: 00:42        │
│  ┌─────┐                                            │
│  │SET 3│       [ START NEXT SET ]                   │
│  └─────┘                                            │
│                                                     │
├─────────────────────────────────────────────────────┤
│  EXERCISE   |    WEIGHT    |    REPS                │
│  [grid]     |    [grid]    |    [grid]              │
└─────────────────────────────────────────────────────┘
```

- The **session rail** on the left is an overlay (absolute-positioned inside `.stage`) of recent sets — last 5 — fading older cards toward the top. Click a card to edit that set in a modal.
- The **bottom panel** with three zones (Exercise / Weight / Reps) is always visible regardless of mode. You can pre-tweak the next set's params during rest, or adjust the current set's params during lifting.
- The **stage** holds the state label, big timer, meta line (target + last rest), and the primary action button.

There's a low-opacity **footer** below the bottom panel for Pause / Discard set, only shown during `lifting` and `resting`.

---

## Responsive breakpoints

| Width | Config layout | Rail behavior | Other |
|---|---|---|---|
| ≥ 1100px | 3-column (1.4fr / 1fr / 1fr) | Full cards (set num + main + rest) | Default sizing |
| 820–1099px | 3-column (1fr / 1fr / 1fr) | Compact cards (drop rest line), narrower rail | App padding, config gap, timer tighten |
| 600–819px | 3-column (1fr / 1fr / 1fr) | Minimal: `SET N` badge, **hover expands** (pointer devices only) | Header compresses further, timer caps at 96px |
| ≤ 599px | **Tabbed** (Exercise / Weight / Reps — one at a time) | Minimal: `SET N` badge, tap directly opens edit | Icon-only header buttons, kbd hints hidden, bigger touch targets |

Panel height is `min(420px, 55vh)` so on shorter viewports the timer doesn't get squeezed.

**Phone config tabs (≤599px)**: The three config zones become a tab bar. Selecting an exercise auto-advances to the Weight tab; selecting a weight auto-advances to Reps. Tab state is tracked in `STATE.configTab`. On wider viewports the tab bar is `display: none` and all three zones show simultaneously.

**Rail expand on touch**: The hover-expand behavior for minimal-mode rail cards is gated with `@media (hover: hover)` so it only fires on devices with a real pointer. On touch, tap goes directly to the edit modal.

---

## Persistent state (localStorage)

Two keys:

- `rt-settings` — per-exercise rest targets (in seconds), quick-pick weights per exercise, quick-pick reps, sound on/off, wake-lock on/off, lb/kg unit
- `rt-history` — array of completed sessions; each session contains its sets array, start/end timestamps, and notes

```js
// rt-settings shape
{
  targets: { 'Squat': 180, 'Bench': 180, ... },
  quickWeights: { 'Squat': [135, 185, 225, 275], ... },
  quickReps: [3, 5, 8, 10, 12],
  sound: true,
  wake: true,
  unit: 'lb',
}
```

History viewing/editing happens in the History modal (calendar-style picker → session detail).

---

## Code organization (within the single file)

```
<style>
  :root { ...CSS variables... }
  .app, .header, .main, .stage, .panel-area      ← layout
  .session-rail, .session-rail-item              ← left overlay (recent sets)
  .timer, .state-label, .primary-btn, .timer-meta ← main stage content
  .config-zones, .zone, .zone-grid, .chunk       ← bottom panel buttons
  .modal-*, .settings-*, .history-*              ← modals
  @media queries                                  ← responsive
</style>

<body>
  .app
    .header
    .main
      .stage
        #session-rail        ← absolutely positioned overlay
        #state-label
        #timer
        #timer-meta
        #primary-btn
      .panel-area
        #bottom-panel        ← config zones (always visible)
        #footer              ← pause/discard, hidden in `ready`
  .modal-backdrop × N        ← settings, history, notes, edit-set, custom-value, custom-exercise
</body>

<script>
  STATE, SETTINGS, history       ← in-memory app state
  loadSettings, saveSettings, loadHistory, saveHistory
  fmtTime, parseTimeStr           ← time formatting
  beep, chimeTarget, chimeOver    ← Web Audio API blips
  requestWakeLock, releaseWakeLock ← Screen Wake Lock API
  render() = renderState + renderConfig + renderHeader + renderSessionRail
  primaryAction, beginSession, finishLifting, startNextSet  ← state transitions
  togglePause, discardSet, editSetByIndex, saveEditedSet
  startTimer, startElapsed, updateTimer  ← interval-driven timer ticks
  selectExercise, selectWeight, selectReps, openCustomValue
  openSettings, openHistory, openNotes ... ← modals
  keyboard listeners (space, P, ESC)
</script>
```

---

## Keyboard shortcuts

- **Space** — primary action (begin / finish set / start next set)
- **P** — pause/resume the active timer
- **E** — edit the last set (only while resting)
- **ESC** — close any open modal

---

## Audio cues (during rest)

When sound is enabled, the timer plays:
- A two-tone chime when rest hits the target duration for that exercise
- A lower tone when rest reaches 2× the target ("you're loitering")

Frequencies are hardcoded in `chimeTarget()` and `chimeOver()`.

---

## Known design choices worth not breaking

- **Single file**. Don't split into modules unless you have a reason. The whole thing is ~2100 lines and stays in one mental model that way.
- **No framework**. Vanilla JS, direct DOM manipulation through `render()` calls. State changes call `render()`, which re-renders the four chunks (state, config, header, rail).
- **The bottom panel never swaps content based on mode** — this was an explicit fix from an earlier iteration. The session rail overlay replaced the old "recent sets" panel during lifting, so config can stay put.
- **Rail cards in minimal mode reveal full content on hover** (pointer devices), then click opens edit. On touch devices the expand is skipped — tap goes straight to edit. Don't conflate these into one interaction.
- **Color tokens** in `:root` (e.g., `--selected: #2b3247`, `--green`, `--amber`, `--red`, `--blue`). The selected button color is intentionally muted vs. the bright `--blue` used for input focus rings.

---

## Things that would be reasonable to add

- Charts/trends for an exercise across sessions (history tab is currently a list view)
- Per-set notes (the app has session-level notes only)
- Export to CSV
- Programmable workout templates ("today is push day → these exercises in this order")
- PWA manifest + service worker for offline install
