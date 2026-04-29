# Universal Search — Design

**Date:** 2026-04-28
**Branch target:** `tulsi/visual-design`
**Figma:** [Search — Default](https://www.figma.com/design/e43a6gyBVn1SdARFkZpN0N/Goose-Brand-%E2%80%94-Q2-2026?node-id=234-2670) · [Search — Populated](https://www.figma.com/design/e43a6gyBVn1SdARFkZpN0N/Goose-Brand-%E2%80%94-Q2-2026?node-id=234-1070)

## Summary

Add a Spotlight-style universal search page reachable from a top-bar search icon and a `Cmd+K` shortcut. The page surfaces results across four sources — **Chat**, **Extensions**, **Agents**, **Skills** — in a fixed four-slot grid below a giant input rendered as the page heading. Per-section pages (Session History, Skills, Agents, Extensions Settings) keep their own scoped search; this is the cross-cutting view.

Note: the populated Figma frame still shows `Projects` and `Personas`. Those labels are stale for this build. Projects are intentionally not searchable in V1, and `Personas` is the old user-facing term for `Agents`.

## Goals

- Single keyboard shortcut (`Cmd+K`) to jump from any view into search
- Live results across all four sources as the user types
- Click any result to navigate to that item's existing page/detail
- Visual fidelity to the Figma design (114px Cash Sans Light heading, four `259×512` max cards on a dotted-grid canvas)
- Reuse existing per-source data — no new backend work for V1

## Non-goals

- **No projects column.** Projects are intentionally scoped out of universal search for V1.
- **No deep-content search for Extensions/Agents/Skills.** Title + description/system-prompt substring match only. Chat retains its existing deep-message search via `useSessionSearch`.
- **No catalog UI for extensions installation flow.** Available extensions appear in results and clicking opens the existing Settings → Extensions modal flow; install/configure UI lives there.
- **No arrow-key navigation across columns in V1.** Native `Tab` order is sufficient. Spotlight-style up/down across columns is V2.
- **No animation-timing tests.** Visual QA is the right verification surface for motion.

## User-facing behavior

### Triggers

- **Search icon** in the top bar (between sidebar toggle and breadcrumb) — `onClick` switches to the `"search"` app view
- **`Cmd+K`** from any view — registered alongside the existing `Cmd+B` sidebar shortcut in `AppShell`
- Already in the `"search"` view? `Cmd+K` is a no-op

### States

| State | Heading | Result region |
|---|---|---|
| Empty query | Placeholder `"Search your world"` at `opacity: 0.10`, vertically centered (`top: calc(50% - 62px)`) | Hidden — canvas is just dot grid + heading + composer pill |
| Query with ≥1 match somewhere | Typed query at `opacity: 1.0`, raised position (`top: calc(50% - 264px)`) | Four-slot grid; each slot renders a card if its source has results, otherwise nothing |
| Query with zero matches anywhere | Typed query at raised position | Single centered italic-muted line: `"No matches for \"<query>\""` in lower half of canvas |

### Per-source behavior

| Source | Result content | Click behavior |
|---|---|---|
| Chat | Title (session title) + meta `"3 days ago · 24 messages"` (new `sessionMetaLine` util, using existing i18n formatters) | Set active session + navigate to `chat` view |
| Extensions | Title (`getDisplayName(entry)`) + meta `"<state> · <description>"` where state is `"Enabled"` or `"Available"` | Open Settings → Extensions + open `ExtensionModal` for that entry |
| Agents | Title (`persona.displayName`, because the internal data model still uses the old Persona type) + meta concise summary derived from `persona.systemPrompt` | Navigate to `agents` page + open agent/persona detail for that id |
| Skills | Title (`skill.name`) + meta `skill.description` (verbatim) | Navigate to `skills` page + open that skill's detail |

### Result depth and ranking

- **Chat:** title + ACP message-body content (existing `useSessionSearch` behavior, unchanged)
- **Extensions / Agents / Skills:** case-insensitive substring match on each source's title plus its existing descriptive body (`description`, `systemPrompt`, or skill description)
- No ranking algorithm. Results returned in the source's natural order. Future enhancement.

### Per-column overflow

- Each card is a `259px` wide container with `512px` max height. On shorter windows, cards shrink and scroll internally so they do not run under the composer pill.
- Result list inside the card is scrollable (`overflow-y-auto`, `scrollbar-none`)
- Reuse the existing `BottomFade` component to hint at scroll overflow when content exceeds card height
- No "Show all" handoff to per-section pages — the universal search IS the destination for all results from a query

### Empty/partial states

- **State B (some columns empty):** Visible cards pack from the left edge using the same slot positions (`37, 332, 627, 922`) while preserving source order: Chat, Extensions, Agents, Skills. Empty source columns render nothing and do not leave gaps.
- **State C (all columns empty):** Cards grid hidden; single centered italic-muted message rendered in the lower half of canvas where the cards would have been. Heading stays at its raised position.

### Keyboard

| Key | Context | Behavior |
|---|---|---|
| `Cmd+K` | Any view | Switch to `"search"`; focus heading input |
| `Cmd+K` | `"search"` | No-op |
| `Esc` | `"search"`, query non-empty | Clear query; keep view focused |
| `Esc` | `"search"`, query empty | Navigate to previous view (default `home`) |
| `Tab` | `"search"` | Native focus order: input → first chat row → next chat rows → first extension row → ... |
| `Enter` | Focused result row | Invoke that row's navigation |

### Focus management

- **On mount:** `useEffect` calls `inputRef.current?.focus()`
- **On view activation:** SearchView is mounted only while `activeView === "search"`, so mount focus covers activation.
- **Click on canvas (non-result, non-composer):** no special handler in V1. Keeping the backdrop static avoids turning a large non-control region into an interactive element.
- **Click on result:** result's navigation handler runs; SearchView is unmounted/backgrounded by the view switch — no special focus handling

## Visual design (extracted from Figma)

### Page chrome

- Canvas: `bg: #dedede`, dot-grid background image (already present app-wide)
- Search renders as a shell-level full-canvas view, not inside the normal sidebar layout:
  - The sidebar and resize rail remain toggleable while `activeView === "search"`; when collapsed, the search canvas matches the 1440×1024 Figma frames.
  - The status bar is hidden on search, matching the screenshots and leaving the floating composer pill unobstructed.
  - `TopBar` remains visible above the canvas.
- Top bar (existing `TopBar` component, with one new icon button):
  - Order: traffic lights → sidebar toggle → **new search-magnifier icon** → breadcrumb (`"Tulsi's World / Search"`)
  - Icon: Tabler `IconSearch`, matching the current `TopBar` icon family
  - Treatment: `<Button variant="ghost" size="icon-sm">` matching the sidebar toggle
  - Always visible (not conditional)

### Breadcrumb

- Existing `PAGE_LABELS` in `TopBar.tsx` gets `search: "Search"` added
- Separator stays as the existing `" / "` (single-space) — Figma shows `"/    Search"` (4 spaces) but that reads as designer-eye kerning in the mockup, not a literal copy spec. Decided in brainstorm.

### Heading input

| Property | Value |
|---|---|
| Element | `<input>` (not `<h1>` wrapping an input) |
| Font | Cash Sans Light, `text-[114px]`, `leading-[0.96]`, `tracking-normal` |
| Color | `#19191a` (verify against `--text-title-alex` token; align if equivalent) |
| Background | transparent |
| Border / outline | none |
| Width | `calc(100% - 80px)` |
| Position | `absolute left: 40px` inside the full-canvas search layer |
| `top` | `calc(50% - 62px)` empty / `calc(50% - 264px)` with query, measured against the full 1440×1024 search frame |
| Transition | `top 250ms ease-out` |
| Placeholder | `"Search your world"` via `placeholder` attr; `::placeholder` styled to `opacity: 0.10` of the same color |
| Caret | Native (no `caret-color: transparent`). At 114px font-size the native caret is close to the Figma's 103px. Pixel-perfect overlay is a polish-pass concern, not V1. |
| Focus | Imperative mount focus via `inputRef.current?.focus()` |

### Result cards (four slots)

| Property | Value |
|---|---|
| Container position | `absolute top: 374px` |
| Slot count | 4 (fixed) |
| Slot left positions | Visible cards use `37, 332, 627, 922` (each 295px apart), packed from left while preserving source order |
| Card size | `259 × 512` max, responsive height with internal scrolling; `220px` minimum before very small windows begin to clip |
| Card background | `bg: white at opacity 0.60`, `rounded-[20px]` |
| Section chip | pill labels `Chat`, `Extensions`, `Agents`, `Skills`; `bg-[#dedede]`, `text-[14px] Cash Sans Regular #19191a`, `px-[6px] pb-[3px]`, positioned `left: 20px from card-left, top: 21px from card-top` |
| Result rows container | `top: 59px from card-top, left: 24px from card-left, width: 222px`, `overflow-y-auto`, `scrollbar-none` |
| Optional fade overlay | reuse `BottomFade` component at card bottom |

### Result row (shared visual)

| Property | Value |
|---|---|
| Container | `flex flex-col gap-[4px] items-start`, `width: 222px` |
| Title | `text-[16px] leading-[20px] text-[#242424] Cash Sans Regular` |
| Meta | `text-[10px] leading-normal text-[#7f7f7f] Cash Sans Regular` |
| Row gap (between rows) | `24px` (owned by parent column flex container) |
| Hover | title `text-[#000]`; cursor pointer; **no background change** |
| Focus (keyboard) | `focus-visible:ring-1`, color `var(--text-muted-alex)` — only on keyboard nav |
| Active (mousedown) | title `opacity: 0.7` |

### State C centered message

- Rendered in the lower half of canvas (where cards would have been); heading stays at raised position
- Style: `text-[14px] text-[var(--text-muted-alex)] italic`, centered horizontally
- Content: `"No matches for \"<query>\""`

### Floating composer pill

- Existing `GlobalComposerPill` continues to render at its existing fixed bottom-right position. Not touched by this work.
- Search results reserve bottom space for the fixed composer on shorter windows (`card height = min(512px, available height - composer clearance)`), so cards stop above the pill before overlapping it.

## Animation choreography

| Element | When | Animation |
|---|---|---|
| Heading `top` | empty ↔ populated | `top 250ms ease-out` |
| Heading text/placeholder opacity | always | Browser-native swap (no JS); placeholder is `opacity: 0.10`, value is `opacity: 1.0` |
| Card appear | slot 0 → N results | `opacity 0 → 1, 200ms ease-out` |
| Card disappear | slot N → 0 results | Instant hide (no exit animation) — asymmetric on purpose; fade-out adds visual noise during fast typing |
| State C centered message | empty → zero-match | `opacity 0 → 1, 200ms ease-out` |
| Reduced motion | `prefers-reduced-motion` | All transitions become `transition: none` |

The 250ms heading vs 200ms cards split is intentional: the heading carries more visual weight (114px display text) and benefits from a slightly slower deliberate move; cards are smaller and want to feel snappy.

## Architecture

### Approach

**Per-source hooks composed in SearchView.** Chat reuses the existing `useSessionSearch` hook unchanged. Three new lightweight hooks (`useExtensionSearch`, `useAgentSearch`, `useSkillSearch`) each subscribe to or fetch their own source and return a memoized title-filter result. SearchView drives all four with the same debounced query.

### File layout (new)

```
src/features/search/
├─ hooks/
│  ├─ useExtensionSearch.ts
│  ├─ useAgentSearch.ts
│  └─ useSkillSearch.ts
├─ ui/
│  ├─ SearchView.tsx
│  ├─ SearchHeadingInput.tsx       — extracted styled <input>
│  ├─ SearchResultsCard.tsx        — one card slot, generic over row content
│  ├─ ResultRow.tsx                — shared visual atom (title + meta)
│  ├─ ChatResultRow.tsx
│  ├─ ExtensionResultRow.tsx
│  ├─ AgentResultRow.tsx
│  └─ SkillResultRow.tsx
└─ lib/
   ├─ filterByQuery.ts             — shared substring-match utility
   └─ sessionMetaLine.ts           — relative time + message-count label for chat rows
```

Plus one shared addition:

```
src/shared/hooks/useDebouncedValue.ts   — ~15 lines
```

### Routing

`AppShell.tsx` changes:

```ts
export type AppView =
  | "home"
  | "chat"
  | "skills"
  | "agents"
  | "projects"
  | "session-history"
  | "search";
```

Plus:

- New `previousView` ref in `AppShell`, updated on every `setActiveView` call (with the *outgoing* view)
- New global keydown handler for `Cmd+K` → `setActiveView("search")` (registered alongside existing `Cmd+B`)
- SearchView's `onExit` calls back into AppShell to set view to `previousView ?? "home"`
- While `activeView === "search"`, render the full-canvas search layer at shell level, keep the sidebar toggleable, and suppress the status bar.

`TopBar.tsx` changes:

- `PAGE_LABELS["search"] = "Search"`
- New search-icon `Button` rendered between sidebar toggle and breadcrumb `<h1>`
- Click handler: `onNavigate?.("search")`

### Per-source hook contracts

#### `useSessionSearch` (existing — chat) — unchanged

Already imported pattern:

```ts
const {
  query, submittedQuery, results, isSearching, error,
  setQuery, search, clear,
} = useSessionSearch({ sessions, resolvers, locale, getDisplayTitle });
```

SearchView passes the debounced query via `setQuery` and calls `search(debouncedQuery)` after debounce settles.

#### `useExtensionSearch(query: string)`

```ts
type ExtensionSearchResult = {
  entry: ExtensionEntry;
  state: "enabled" | "available";
};

function useExtensionSearch(query: string): ExtensionSearchResult[];
```

- Uses the same `listExtensions()` API that `ExtensionsSettings.tsx` uses
- Hook owns a module-level cache for immediate paint, then refreshes on mount so Settings edits do not leave search stale
- Uses `filterByQuery` over `getDisplayName(entry)`, `entry.name`, `entry.description`, and `entry.type`
- Tags each result with its `state` based on `entry.enabled` (`enabled` or `available`, used for the meta label and click destination)
- Returns `[]` while the initial fetch is in flight (no loading indicator surfaced in V1)

#### `useAgentSearch(query: string)`

```ts
function useAgentSearch(query: string): Persona[];
```

- Reads `useAgentStore` selector for the persona list; the code still uses the old Persona type, but the UI source label is `Agents`
- Uses `filterByQuery` over `persona.displayName` and `persona.systemPrompt`
- Meta row uses a concise system-prompt summary, truncated to one visual line by the row component
- Synchronous

#### `useSkillSearch(query: string)`

```ts
function useSkillSearch(query: string): SkillInfo[];
```

- Skills has no Zustand store — hook owns the fetch
- Module-level cache: first mount triggers `listSkills()` (existing API at `src/features/skills/api/skills.ts`); subsequent mounts use the cache
- Filtered output via `filterByQuery` over `skill.name` and `skill.description` (verify `description` field exists on `SkillInfo` during implementation; if not, adjust to whichever field carries the human-readable summary)
- Returns `[]` while initial fetch is in flight (no loading indicator surfaced in V1)

#### Shared: `filterByQuery`

```ts
export function filterByQuery<T>(
  items: T[],
  query: string,
  getSearchableFields: (item: T) => string[],
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  return items.filter((item) =>
    getSearchableFields(item).some((field) =>
      field.toLowerCase().includes(trimmed),
    ),
  );
}
```

#### Shared: `useDebouncedValue`

```ts
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

SearchView holds `query` (immediate, drives heading display) and computes `debouncedQuery = useDebouncedValue(query, 100)` (drives all four search hooks).

### SearchView component

```
SearchView (full-canvas container)
├─ SearchHeadingInput (<input> styled as 114px display text, animated `top`)
└─ Result region (state machine)
    ├─ State A (empty query)        → render nothing
    ├─ State B (≥1 match somewhere) → 4-slot grid, render card-or-nothing per slot
    └─ State C (zero matches)       → centered italic message
```

State derivation:

- `state === "A"` when `debouncedQuery.trim() === ""`
- `state === "C"` when `debouncedQuery.trim() !== ""` AND all four hook outputs are empty
- `state === "B"` otherwise

### Result row components

- `ResultRow` is the generic visual atom — props: `title`, `meta`, `onClick`. No source knowledge.
- Per-source wrappers (`ChatResultRow`, `ExtensionResultRow`, `AgentResultRow`, `SkillResultRow`) map source data → `{ title, meta }` and bind their navigation handlers.
- Per-source navigation handlers come from `AppShell` props (existing `handleNavigate`, `handleSelectSession`, etc.) threaded through SearchView.

### Detail-view handoff wiring

Three target surfaces need an "open this item" affordance to make click navigation land at the right detail:

- `ExtensionsSettings` — open `ExtensionModal` for an entry, via `SettingsModal` opened to the `extensions` section
- `AgentsView` — open agent/persona detail
- `SkillsView` — open skill detail

Agents can open by id because the store owns loaded persona state. Extensions and Skills receive the selected result object from SearchView, not only an id/name, so they can open the target modal immediately even if their page-level list refresh is still loading.

## Testing

### Unit tests (new)

```
src/features/search/lib/__tests__/filterByQuery.test.ts
src/features/search/hooks/__tests__/useExtensionSearch.test.ts
src/features/search/hooks/__tests__/useAgentSearch.test.ts
src/features/search/hooks/__tests__/useSkillSearch.test.ts
```

Coverage:
- `filterByQuery`: empty/whitespace queries → `[]`; case insensitivity; substring match across all fields; unicode/diacritics (default behavior — flag if needed)
- Per-source hooks: mock the underlying source, provide a query, assert filtered output
- `useSkillSearch` additionally: fetch happens on first mount, subsequent mounts don't refetch

Chat search has existing coverage at `useSessionSearch.test.ts` — no new chat-adapter tests since we consume it as-is.

### Integration tests (new)

```
src/features/search/ui/__tests__/SearchView.test.tsx
```

High-leverage flows:
- Empty query: no cards, heading shows placeholder
- Type "alpha": all four hooks called with debounced query, cards render
- Zero matches anywhere: cards hidden, centered message visible
- Partial matches: only matching slots render, packed from the left while preserving source order
- Click chat row: `onSelectSession` and `onNavigate("chat")` called
- Click extension row: opens Settings → Extensions and opens the matching extension modal
- Click agent / skill row: equivalent assertions
- ESC with non-empty query: query clears, view stays
- ESC with empty query: `onExit` called

### Edge case tests (subset of integration)

- Rapid typing: debouncing prevents N parallel chat ACP searches; existing `requestIdRef` cancellation in `useSessionSearch` is not bypassed
- Auto-focus on mount

### Explicitly NOT tested in V1

- Tab order across columns (browser-implementation-dependent; brittle)
- Animation timing (manual visual QA is the right tool)
- `prefers-reduced-motion` (browser-native)

### File-size guardrail

`scripts/check-file-sizes.mjs` enforces 500 lines default. Realistic estimates:

- `SearchView.tsx`: 250-350 lines (under cap)
- `useExtensionSearch` / `useAgentSearch` / `useSkillSearch`: 30-60 lines each
- `ResultRow` + 4 source wrappers: 30-50 each
- `filterByQuery.ts`: ~15 lines

No exceptions expected. If `SearchView.tsx` ends up over 500, extract slot-rendering into a separate `SearchResultsGrid.tsx` rather than bump the cap.

## Decisions log

| Question | Decision | Reasoning |
|---|---|---|
| Result content depth | Title/meta for extensions/agents/skills; deep for chat (reusing `useSessionSearch`) | Best UX-per-effort ratio; chat is highest-volume content with infrastructure already in place |
| Triggers | Search icon + `Cmd+K` from anywhere | Universal "spotlight" expectation; "/" key has conflicting meaning in skill picker |
| Per-column overflow | Scrollable card (overflow-y inside) | Self-contained spotlight feel; no per-section query-handoff wiring |
| Click result behavior | Navigate to existing per-section page; open detail | Lower V1 effort than action-style (no new flows); reuses existing pages |
| Projects column | Scoped out for V1 | Product direction: projects are not globally searchable |
| Extensions column | Included for V1 | Product direction: extensions are the second source despite stale Figma label copy |
| Agents label | Use `Agents` in UI | `Personas` is the old term; implementation may still touch Persona-named types/stores until the data model catches up |
| Heading mechanic | Native `<input>` styled as the heading | Single source of truth; native paste/IME/Cmd+A; minimal abstraction |
| Empty/partial states | Visible cards pack left, empty sources render nothing + C1 (centered message for zero-everywhere) | Matches the latest product feedback: sparse results should start at the left edge instead of floating in a middle slot |
| Architecture | Per-source hooks composed in SearchView | Modular, future-friendly, matches existing `useSessionSearch` pattern |
| Skills data | Hook owns fetch with module-level cache | Self-contained abstraction; matches the shape of other hooks |
| Debounce | 100ms | Live-feeling without spamming chat ACP |
| Card disappear animation | Instant (no exit) | Fade-out adds visual noise during fast typing |
| Heading vs cards animation | 250ms heading, 200ms cards | Heading carries more visual weight; cards want to feel snappy |
| Tests not written in V1 | Tab order, animation timing, reduced-motion | Brittle / browser-native / wrong-tool-for-the-job |

## Implementation order (suggested)

1. Add `useDebouncedValue` and `filterByQuery` (shared utilities)
2. Add `"search"` to `AppView` and `PAGE_LABELS`; add the search-icon button to `TopBar`
3. Wire `Cmd+K` and `previousView` ref in `AppShell`
4. Build `SearchView` shell with the heading input and state-A/B/C state machine (no real data yet, mock)
5. Per-source hooks (`useExtensionSearch`, `useAgentSearch`, `useSkillSearch`)
6. `ResultRow` + four per-source row components
7. Wire chat: thread `useSessionSearch` through SearchView with the debounced query
8. Wire detail-view handoff for each source (selected object where list refresh can be slow; id where the store already owns loaded state)
9. Animation pass (heading top, card appear, state C fade-in)
10. Tests
11. Visual QA against Figma frames

## Known unknowns

- **Detail-view handoff affordances** for extensions/agents/skills — verify each surface accepts a selected-result prop or store-driven open trigger; adapt where missing (see Architecture section).
- **`--text-title-alex` token equivalence to `#19191a`** — verify during implementation; align if exact equivalent, otherwise use literal hex.
- **Skill API fetch timing** — if first-mount fetch is noticeably slow (>300ms), revisit whether to surface a column loading indicator. Punt until observed.
