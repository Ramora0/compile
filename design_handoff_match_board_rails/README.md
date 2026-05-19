# Handoff: Compile — Match Board (Rails Layout)

## Overview

This handoff covers the redesigned **Match Board** screen for *Compile*, a digital CCG. The redesign solves a specific tension: the board is desktop-shaped (16:9) but the core of the game is **3 vertical lanes** that stretch up and down, where cards are played on top of each other. The previous design's horizontal chrome (top header band, bottom hand band, opponent zone band) ate ~50% of the vertical real estate, leaving the lanes feeling cramped.

The **Rails layout** moves all secondary chrome (player nameplates, opponent's hand preview, deck/discard counts, turn/score, action log, end turn button) onto two side rails. This lets the 3 lanes stretch nearly floor-to-ceiling (~900px tall on a 1200px canvas, up from ~650px). Lane headers were also collapsed from 3 stacked layers (~80px each) to a single slim ~44px strip.

The handoff also includes the prior **Classic layout** (`compile-board.jsx`) for reference — it's exposed in the design as a toggle so the team can A/B side-by-side.

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** — high-fidelity prototypes showing intended look, structure, and basic interaction. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, native, Unity UI, etc.) using its established component patterns, design tokens, and conventions. If no UI environment is established yet, use React + TypeScript with CSS variables for tokens — that maps most directly to what's in these files.

In particular: the design files use inline-style positioning (`position: absolute`, hard-coded pixel offsets) for fast prototyping. In production, use flex/grid and CSS modules / styled-components / your framework's idiomatic styling.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, glow treatments, and component proportions are all specified. Hex values, font sizes, and layout dimensions can be lifted directly. Interactions (hover-lift on hand cards, log expand-to-overlay) are partially implemented and should be matched in behavior.

## Canvas

- Design canvas: **1920 × 1200** (16:10 desktop)
- The canvas is wrapped in a `<Stage>` component that scales it via CSS transform to fit any viewport while preserving aspect ratio (letterboxes on mismatched sizes).
- Production should adopt the same approach — design at 1920×1200 and scale uniformly. Do **not** make the board responsive in the traditional sense; it's a fixed-aspect game viewport.

## Screens / Views

### Match Board — Rails Layout

**Purpose:** The main in-match view. Player sees the 3 lanes (with cards stacked from both sides toward a central "Line"), their hand, both players' resources, score, turn state, and recent actions.

#### Layout zones

```
┌─────────────────────────────────────────────────────────┐
│ TOP: 18px breathing room (no header)                    │
├──────────┬─────────────────────────────┬────────────────┤
│  LEFT    │                             │  RIGHT RAIL    │
│  RAIL    │      3 LANES (center)       │  (320w × 900h) │
│  240w    │      ~1196w × 900h          │                │
│  × 260h  │                             │  · opp block   │
│  (log    │                             │  · turn band   │
│   panel  │                             │  · you block   │
│   only,  │                             │                │
│   space  │                             │                │
│   below  │                             │                │
│   is     │                             │                │
│   empty) │                             │                │
├──────────┴─────────────────────────────┴────────────────┤
│ BOTTOM: hand strip (1920 × 282)                         │
│  5 hand cards centered (188×268 each, gap 18)           │
└─────────────────────────────────────────────────────────┘
```

**Layout constants** (see `compile-board-rails.jsx`):
- `PAD = 48` — outer horizontal padding
- `LEFT_W = 240` — left rail width
- `RIGHT_W = 320` — right rail width
- `RAIL_GAP = 20` — gap between rail and lane area
- `TOP_OFFSET = 18` — top breathing room
- `BOTTOM_H = 282` — bottom hand strip height
- `RAIL_H = 900` — rail vertical extent (1200 − 18 − 282)
- `LANES_X = 308` — left edge of the lane area
- `LANES_W = 1196` — total width for 3 lanes
- Lane grid: `repeat(3, 1fr)` with `gap: 22px`
- `CARD_STACK_SPACING = 50` — vertical offset between stacked field cards (so top ~third of each card is visible)

#### Components

##### 1. Lane (×3, center column)

Each lane is a vertical panel with:
- **Slim opp header** (top, 44px) — element sigil + element name + compile bar + `N/10` count + inline `✓ COMPILED` tag when applicable
- **Opp card stack** (top half) — field cards rendered face-up or face-down, stacked downward from the top, rotated 180° (so opp cards appear "upside down" from your perspective). Spacing: each subsequent card is offset by `CARD_STACK_SPACING (50px)` so the top ~third of the card below remains visible. The topmost (most recent) card is full brightness; older cards are dimmed (`filter: brightness(0.85)`).
- **Line divider** (center, 22px) — a horizontal dashed line bisecting the lane, with a small pill in the middle reading `LINE · 01` / `LINE · 02` / `LINE · 03`. Pill style: `JetBrains Mono` font, 9px, letter-spacing `0.28em`, color `var(--ink-faint)`, `var(--void-2)` background, `var(--line-2)` border, fully rounded.
- **Your card stack** (bottom half) — same as opp but stacked upward from the bottom, not rotated.
- **Slim you header** (bottom, 44px) — mirror of opp header

##### 2. Slim Lane Header (`SlimLaneHeader`)

Single row, 44px tall, 14px horizontal padding, with:
- **Left**: 22×22 round sigil pip (`Sigil` component) + element name in mono, 12px, 700 weight, 0.18em letter-spacing, colored to element
- **Middle (flex)**: `CompileBar` — a 6px tall rounded bar showing fill (`value/max`), glowing in the element color
- **Right**: `N/10` text in mono, 14px 700, element color (with `/10` in `var(--ink-faint)` and 400 weight)
- **Compiled state**: inline pill reading `✓ COMPILED`, mono 9px 700, 0.2em letter-spacing, element color text + 1px element-color border + `rgba(var(--el-rgb), 0.12)` background + 4px radius
- **Top header** has `borderBottom`, **bottom header** has `borderTop`, color `rgba(var(--el-rgb), 0.18)` (or `0.4` when compiled)
- When compiled, header also gets a subtle `cp-lane-compiled` background gradient

##### 3. Left Rail — Action Log (compact)

- Position: top-left, absolute. Width 240, **height 260** only (not full rail).
- Panel chrome: `cp-panel` (standard `rgba(13,11,34,0.6)` background, `var(--line-2)` 1px border, `var(--r-md)` radius)
- Padding 16
- Header row: `Action Log` panel title (mono 10px, 0.22em letter-spacing, `var(--ink-faint)`) + small "EXPAND ↗" button (`cp-btn ghost`, 9px font, 4px×10px padding)
- Body: top **4 entries** only, with a fade mask at 70% (`maskImage: linear-gradient(180deg, black 70%, transparent)`)
- Each entry: 5px×6px padding, `JetBrains Mono` font 10.5–11px, single-line truncated (ellipsis). First entry has a `rgba(139,92,246,0.10)` background and 2px purple left border.
- Format per entry: `[T6.1]  [YOU/KEIKO]  [event text in element-tinted color]`
- Compile events show `bold: true` and the element color saturated

##### 4. Log Overlay (modal)

- Triggered by EXPAND button
- Full-canvas overlay: `position: absolute`, `inset: 0`, `zIndex: 100`, `rgba(6,6,26,0.78)` backdrop with `backdropFilter: blur(8px)`
- Click backdrop to dismiss (event-stops the inner panel)
- Inner panel: 620 wide, max-height 820, padding 24, `cp-panel` chrome + extra purple inner shadow `0 0 0 1px var(--purple-500) inset, 0 20px 60px rgba(0,0,0,0.6)`
- Shows all log entries, scrollable, larger fonts (12px), more padding (8×10)
- Close button (`cp-btn`, "CLOSE ×")

##### 5. Right Rail — Mirror Fight-Card

Three stacked sections: **opp block**, **turn band**, **you block**. The turn band is the visual divider that separates the two players' info.

###### 5a. Opp Block (top)

- `cp-panel` chrome, padding 18×20×20
- Vertical gap 16 between sub-items
- **Opp nameplate row**:
  - 44×44 round avatar, `var(--line-3)` border, subtle white→transparent inner gradient, `var(--ink-dim)` glyph `◎` (placeholder portrait)
  - Name: 15px, 600 weight, `var(--ink)` color (`keiko_`)
  - Status: mono 9px, 0.14em letter-spacing, `var(--light)` color, with a small glowing dot (5×5, `box-shadow: 0 0 6px var(--light)`). Text: `THINKING · 0:38`
  - MMR row: mono 8.5px, `var(--ink-faint)`, 0.12em letter-spacing. Text: `1791 MMR · DIV III`
- **Opp hand backwards strip** (`OppHandBackwards`):
  - Centered row of face-down mini-cards
  - Each: 38×56, rotated 180°, 4px radius, uses the `.cp-card.facedown` styles (purple diagonal stripes + radial glow + purple border)
  - Gap 6 between cards
  - Below: mono 9px label `OPP HAND · 5`
- **Deck + Discard tiles row**:
  - Two `ResourceTile`s side-by-side, equal flex
  - See section 5d

###### 5b. Turn Band (middle divider)

- Margin `14px 0` (gap from blocks above/below)
- Padding 16×18
- Background: vertical purple gradient (`rgba(139,92,246,0.10)` → `rgba(139,92,246,0.04)`) over `rgba(13,11,34,0.7)`
- Border: 1px `var(--purple-500)`, radius 8
- Glow: `0 0 0 1px rgba(139,92,246,0.25) inset, 0 0 28px rgba(139,92,246,0.2)`
- **Top row**: `TURN 6` (mono 10px, 0.24em letter-spacing, `var(--ink-faint)`) on left; `BO1` (mono 9px) on right
- **Score row** (margin-top 10): three columns
  - Left: `KEIKO` label (mono 8px, 0.22em letter-spacing, `var(--ink-faint)`) + score numeral. Score is **52px**, 700 weight, line-height 0.9, color `var(--fire)`, with text-shadow `0 0 22px rgba(var(--fire-rgb), 0.6)`, letter-spacing `-0.04em`. Score shown: `2`
  - Middle (min-width 40): `COMP` label + `—` separator (22px, `var(--ink-quiet)`) + `TO 3` label. All mono 8px.
  - Right: `YOU` label (purple-300) + score numeral in `var(--purple-400)` with `0 0 22px rgba(var(--purple-glow), 0.7)` text-shadow. Score: `1`
- **Status pill** (margin-top 12): padding 8×12, `rgba(139,92,246,0.18)` background, 1px `var(--purple-400)` border, 6px radius, centered. Text: `● YOUR MOVE` — mono 11px 700, 0.22em letter-spacing, `var(--purple-300)`, with glowing dot prefix.

###### 5c. You Block (bottom)

Mirror of opp block, but with purple accent treatment:
- `cp-panel` with overridden `borderColor: var(--purple-500)`, purple-tinted gradient background `linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.01))`, and `box-shadow: 0 0 0 1px rgba(139,92,246,0.2) inset`
- Deck + Discard tiles row at top
- You nameplate row (avatar circle is purple-bordered, has purple radial gradient fill, and a glow `0 0 14px rgba(139,92,246,0.4)`)
- Hand count badge on the right of the nameplate: `HAND` label + big 22px purple-300 numeral
- **End Turn button** at bottom: full width, `cp-btn primary` (purple gradient `linear-gradient(180deg, var(--purple-500), var(--purple-600))`), padding 14px×0, 13px font, 700 weight, 0.24em letter-spacing, text `END TURN ▶`

###### 5d. Resource Tile (`ResourceTile`)

96×134 card-like tile with count overlaid huge:
- **Deck kind**: stripey purple face-down look — `repeating-linear-gradient(45deg, rgba(139,92,246,0.18) 0 6px, transparent 6px 12px)` + `radial-gradient(circle at 50% 40%, rgba(139,92,246,0.35), transparent 70%)` + `var(--void-3)` base. 1px `var(--purple-500)` border, inner+outer shadow. 8px radius.
- **Discard kind**: dashed empty look — `rgba(245,243,255,0.02)` background, 1px dashed `var(--line-3)` border. Same dimensions.
- **Count overlay**: dark inner panel (`rgba(6,6,26,0.55)` + 2px backdrop-blur) covering the tile, with the count number in 44px display font, 700 weight, line-height 0.9, white, glow `0 0 16px rgba(139,92,246,0.6)` (deck only), letter-spacing `-0.02em`.
- **Label** below tile: mono 9px, 0.2em letter-spacing, `var(--ink-faint)`. Text: `DECK` or `DISCARD`.

##### 6. Hand Strip (bottom)

- Position: bottom 0, full width, height 282
- Top border: 1px `var(--line-2)`
- Background: `linear-gradient(0deg, rgba(13,11,34,0.7), transparent)` (fades up into the lanes)
- Content: 5 hand cards, centered, gap 18, aligned to bottom of strip with 22px padding below
- Each card: full `Card` component at hand size (188×268)
- **Hover state**: card translates up by 30px (`translateY(-30px)`), `z-index: 10`, with `transition: transform 0.18s ease`. A floating chip label `● HOLDING` appears 22px above the card: purple-bordered, purple-300 text, `rgba(139,92,246,0.2)` background, mono 8px, 2×8 padding.

##### 7. Card (`Card` component)

The hero element. Holographic CCG card. Two sizes: `hand` (188×268) and `field` (124×174).

**Hand size** structure:
- Outer: 188×268, `var(--r-md)` radius, 1px border in element color, background = `linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.4)) + var(--void-2)`
- Outer shadow: complex element-tinted (see `compile.css`)
- Inner padding ~14px, flex column
- **Header row**: element name (`.cp-card-el`, mono 11px) on left; big number (`.cp-card-num`, `Space Grotesk` 32px 700, line-height 0.9, `var(--ink)`) on right
- **Art zone** (`.cp-card-art`): flex-1, gradient background mixing element color + void purple, 1px element-tinted border, with a giant central glyph (`::before`, font-size 76+, set via `--el-glyph` custom prop on `.el-*` classes — Unicode chars per element)
- **Effect text** (`.cp-card-effect`): `Space Grotesk` 12.5px, line-height 1.25, white
- **Foot** (`.cp-card-foot`): `TIER A/B` on left, `→ L2` or `PROTOCOL` on right, mono 8.5px, `var(--ink-faint)`, 0.14em letter-spacing
- **Holographic sheen** (`::after`): conic-style gradient overlay, mix-blend mode

**Field size**: same structure but ~66% scale (124×174), with proportionally smaller fonts. Effect text is hidden at field size.

**Face-down state**: replaces inner content with the purple stripey card-back pattern.

##### 8. Top Nav (pre-existing)

Small floating pill at top-center (between Match/Draft screens) — already in the codebase as `.cp-topnav`. Not part of this redesign.

## Interactions & Behavior

- **Hand card hover**: lift by 30px, z-index 10, show "HOLDING" chip. (Currently demoed as a static hover on the middle card; in production wire to actual hover events.)
- **Log EXPAND button**: opens full-canvas modal overlay with all log entries. Click backdrop or CLOSE button to dismiss.
- **End Turn button**: primary action. Click should advance turn and trigger the appropriate game state mutation.
- **Card click/drag** (not yet implemented in design): pick up a hand card and drag to a lane to play it. Future state should highlight valid lane targets.

## State Management

State variables needed for the match view (all mocked in `compile-board-rails.jsx`):

```ts
type MatchState = {
  turn: number;            // current turn number
  yourMove: boolean;       // whose turn is it
  timer: string;           // e.g. "0:38"
  you:  PlayerInfo;        // { name, mmr, hand, deck, disc, compiled }
  opp:  PlayerInfo;
  lanes: Lane[];           // exactly 3 lanes
  hand:  Card[];           // your hand (up to ~5 visible at once)
  log:   LogEntry[];       // action log, newest first
};

type PlayerInfo = {
  name: string;
  mmr: number;
  hand: number;     // count of cards in hand
  deck: number;     // count of cards in deck
  disc: number;     // count in discard
  compiled: number; // number of lanes compiled (0-3)
};

type Lane = {
  n: 1 | 2 | 3;
  you: LaneHalf;
  opp: LaneHalf;
};

type LaneHalf = {
  el: ElementId;       // 'fire' | 'water' | 'light' | 'life' | 'plague' | 'psychic' | 'metal' | 'void' | 'speed' | 'death' | 'spirit' | 'gravity'
  compile: number;     // current compile value (0-10)
  compiled?: boolean;  // true when compile === 10
  cards: Card[];       // cards played in this half
};

type Card = {
  el: ElementId;
  num: number;        // numeric value shown on card
  faceDown?: boolean;
  effect?: string;    // body text (hand size only)
  tier?: 'A' | 'B';
  line?: number;      // intended target lane (for foot text)
};

type LogEntry = {
  t: string;             // turn tag like 'T6.1'
  who: 'YOU' | string;   // player name in caps
  txt: string;           // description, e.g. "play fire-2 → L2"
  tone: ElementId | 'dim'; // color tone
  bold?: boolean;        // compile events
};
```

Local UI state (component-scoped):
- `logExpanded: boolean` — modal open/closed for log overlay
- (Future) `hoveredCardId`, `draggedCardId`, `targetLane`

## Design Tokens

All defined in `compile.css` as CSS custom properties on `:root`. Lift into your token system.

### Surface tones (deep blue-black with violet undertone)
- `--void:    #06061a` — base background
- `--void-2:  #0c0b22`
- `--void-3:  #14132f`
- `--void-4:  #1d1c40`

### Primary palette (purple — "you" color, accent everywhere)
- `--purple-300: #c4b5fd`
- `--purple-400: #a78bfa`
- `--purple-500: #8b5cf6` — primary
- `--purple-600: #7c3aed`
- `--purple-glow: 139, 92, 246` — used in `rgba()` as `rgba(var(--purple-glow), x)`

### Lines & ink (translucent whites)
- `--line-1: rgba(245,243,255,0.06)` — faintest
- `--line-2: rgba(245,243,255,0.12)` — standard borders
- `--line-3: rgba(245,243,255,0.20)` — emphasized borders
- `--ink:       #f5f3ff` — primary text
- `--ink-dim:   rgba(245,243,255,0.62)` — secondary text
- `--ink-faint: rgba(245,243,255,0.36)` — tertiary / labels
- `--ink-quiet: rgba(245,243,255,0.18)` — barely-there

### Element colors (12 elements; saturated, each with `-rgb` companion)
- `--fire:    #ef4444` (`-rgb: 239, 68, 68`)
- `--water:   #38bdf8` (`-rgb: 56, 189, 248`)
- `--light:   #facc15` (`-rgb: 250, 204, 21`)
- `--life:    #22c55e` (`-rgb: 34, 197, 94`)
- `--plague:  #84cc16`
- `--psychic: #a855f7`
- `--metal:   #94a3b8`
- `--void-el: #a855f7` (distinct from `--void` surface)
- `--speed:   #fb923c`
- `--death:   ...` (see `compile.css`)
- `--spirit:  ...`
- `--gravity: ...`

Each `.el-{id}` class sets `--el-color`, `--el-rgb`, and `--el-glyph` (Unicode char) so that nested components can adopt the element's tint without prop drilling.

### Typography
- Body: `'Space Grotesk', system-ui, sans-serif` — primary UI font, used for card names, body text, buttons
- Display: `'Space Grotesk', sans-serif` with 700 weight, used for big numbers (card num, score)
- Mono: `'JetBrains Mono', monospace` — used for labels, timestamps, technical readouts, status chips
- Sizes used in board:
  - Score numerals: 52px 700
  - Card big number (hand): 32px 700
  - Card big number (field): 22px 700
  - End Turn button: 13px 700 0.24em letter-spacing
  - Compile count: 14px 700
  - Element name (lane header): 12px 700 0.18em
  - Nameplate name: 15–16px 600
  - Compile bar X/10: 14px 700
  - Status labels (mono): 8.5–11px, 0.12–0.24em letter-spacing
  - Body card effect: 12.5px / 1.25 line-height
  - Log entries: 10.5–12px

### Spacing scale used
- 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24 (mostly even units; not a strict scale)
- Outer canvas padding: 48
- Rail-to-lane gap: 20
- Inter-lane gap: 22
- Card-stack offset: 50

### Radii
- `--r-md` — standard panel/card radius (defined in css; ~8–10px)
- Card field-size: same `--r-md`
- Tile (deck/discard): 8
- Pill/chip: 999 (fully rounded)

### Shadows / glows
- Standard panel: inset 1px `var(--line-2)` (effectively from the border)
- Primary button: `0 0 0 1px rgba(255,255,255,0.1) inset, 0 6px 22px rgba(var(--purple-glow), 0.55)`
- Turn band: `0 0 0 1px rgba(139,92,246,0.25) inset, 0 0 28px rgba(139,92,246,0.2)`
- Score numerals: text-shadow `0 0 22px rgba(var(--{color}-rgb), 0.6–0.7)`
- Deck count: text-shadow `0 0 16px rgba(139,92,246,0.6)`
- Compile-bar fill: `box-shadow: 0 0 12px var(--el-color)` on the filled inner element

## Assets

No raster assets used. All visuals are:
- CSS gradients (for card art zones, deck patterns, glow effects)
- Unicode glyphs (element sigils — `▲ ◇ ◯ ✚ ※ ◬ ◈ ⬢ ⌁ ✕ ◊ ◉`, declared per element via `--el-glyph` in `compile.css`)
- Web fonts: **Space Grotesk** (400, 500, 600, 700) and **JetBrains Mono** (400, 500, 700) — both via Google Fonts.

Implementer should swap to in-house fonts if the project uses them, otherwise keep these.

## Files

```
design_handoff_match_board_rails/
├── README.md                  ← you are here
├── Compile.html               ← entry point; loads scripts + fonts
├── compile.css                ← all design tokens + base component styles
├── compile-app.jsx            ← top-level router + Tweaks panel scaffold
├── compile-components.jsx     ← shared building blocks (Stage, Card, Sigil,
│                                 CompileBar, ElementName, CompiledTag,
│                                 PlayerNameplate, DeckPile, DiscardPile, etc)
├── compile-board.jsx          ← CLASSIC layout (prior design, kept for reference)
├── compile-board-rails.jsx    ← ★ RAILS LAYOUT — the new design ★
├── compile-draft.jsx          ← draft screen (referenced but not part of this handoff)
└── tweaks-panel.jsx           ← prototype-only Tweaks UI (do NOT port to prod)
```

**Primary file to implement**: `compile-board-rails.jsx`. It contains the `BoardScreenRails` component and all sub-components specific to this layout.

To preview locally, open `Compile.html` in a browser. Tweaks panel (bottom-right) lets you toggle between Classic and Rails layouts.

## Known TODOs / Future Work (discussed but not built)

These were debated during the design session but deferred:
- **Card Inspector** — slot below the action log (~240×620 empty area in the left rail). Would show a zoomed view of whatever card the cursor is over, so field-sized cards become readable on demand without leaving the board.
- **Play Targeting Preview** — bottom-right flank (~454×282 empty). When a hand card is held, shows 3 lane buttons with projected compile delta ("→ L1: 6 → 9", "→ L2: ✗ blocked", "→ L3: 4 → 7").
- **Stretch hand cards larger** (e.g. 210×295) as an alternative to filling the bottom flanks with new UI.

Leave those areas empty in the first pass — they're not strictly missing, just opportunities.
