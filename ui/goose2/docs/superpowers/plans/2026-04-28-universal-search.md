# Universal Search Implementation Plan

**Goal:** Add a full-canvas universal search view matching the 2026-04-28 Figma visual treatment: giant Cash Sans search input, fixed four-column results, dotted canvas, top-bar search entry point, `Cmd+K`, and the existing floating composer pill.

**Source of truth:** `docs/superpowers/specs/2026-04-28-universal-search-design.md`

**Product correction captured:** Projects are not searchable in V1. The second result column is **Extensions**. The Figma label `Personas` is stale copy; the user-facing source is **Agents**, though the current implementation still uses Persona-named types and stores internally.

---

## Phase 0 — Pre-Flight

- [ ] Confirm the working tree before editing with `git status --short`. The spec may already be staged; preserve user-authored changes and avoid broad formatting churn.
- [ ] Re-read the updated spec and both screenshots at 1440×1024. Treat `Projects` and `Personas` in the populated screenshot as stale labels while keeping the layout, dimensions, and spacing.
- [ ] Inspect current shell constraints before touching layout:
  - `src/app/AppShell.tsx`
  - `src/app/ui/AppShellContent.tsx`
  - `src/app/ui/TopBar.tsx`
  - `src/shared/ui/GlobalComposerPill.tsx`
- [ ] Use repo-local tooling (`./bin/pnpm`, `./bin/just`) if global commands are missing.

## Phase 1 — Shell Entry Points

- [ ] Extend `AppView` in `src/app/AppShell.tsx` with `"search"`.
- [ ] Add `search: "Search"` to `PAGE_LABELS` in `src/app/ui/TopBar.tsx`.
- [ ] Add an `onNavigate?: (view: AppView) => void` prop to `TopBar`.
- [ ] Render a ghost `IconSearch` button between the sidebar toggle and breadcrumb. Use `@tabler/icons-react` to match the current top-bar icon family.
- [ ] Wire the search button to `onNavigate?.("search")`.
- [ ] Add `Cmd+K` handling in the existing global keydown handler:
  - Prevent default.
  - If already in `"search"`, do nothing.
  - Otherwise store the outgoing view in `previousViewRef` and switch to `"search"`.
- [ ] Route shell navigation through a helper like `setActiveViewWithHistory(nextView)` so sidebar/topbar/programmatic navigation all update previous-view state consistently.

## Phase 2 — Full-Canvas Search Shell

- [ ] Render search as a shell-level full-canvas view, not inside the normal sidebar layout. This is required because the Figma frame has no visible sidebar and uses viewport-relative x coordinates.
- [ ] While `activeView === "search"`:
  - Keep the sidebar region and resize rail available so the top-bar sidebar toggle works.
  - Hide the status bar.
  - Keep `TopBar` visible.
  - Keep `GlobalComposerPill` visible.
- [ ] Add `SearchView` to `AppShellContent` or render it directly from `AppShell` if that keeps the full-screen layering cleaner.
- [ ] Add `onExitSearch` in `AppShell`: return to `previousViewRef.current ?? "home"`.

## Phase 3 — Search Data Utilities

- [ ] Add `src/shared/hooks/useDebouncedValue.ts`.
- [ ] Add `src/features/search/lib/filterByQuery.ts`:
  - Trim and lowercase query.
  - Return `[]` for empty/whitespace queries.
  - Match any provided field by substring.
- [ ] Add `src/features/search/lib/sessionMetaLine.ts`:
  - Input: `ChatSession`, locale formatters, translation function.
  - Output: e.g. `3 days ago · 24 messages`.
  - Use existing session/common i18n pluralization keys where possible.
- [ ] Add `src/shared/i18n/locales/en/search.json` and `src/shared/i18n/locales/es/search.json` only for new universal-search UI copy that lacks an existing namespace, then register the namespace in `src/shared/i18n/i18n.ts` and `src/shared/i18n/constants.ts`.

## Phase 4 — Source Hooks

- [ ] `useExtensionSearch(query)`:
  - Use the existing `listExtensions()` API from `src/features/extensions/api/extensions.ts`.
  - Use a module-level cache for immediate paint, then refresh on mount so Settings edits do not leave search stale.
  - Filter `getDisplayName(entry)`, `entry.name`, `entry.description`, and `entry.type`.
  - Return `{ entry, state }`, where `state` is `"enabled"` when `entry.enabled` is true and `"available"` otherwise.
  - Return `[]` while the first fetch is pending; no V1 loading indicator.
- [ ] `useAgentSearch(query)`:
  - Read `useAgentStore((s) => s.personas)` because the code still uses the old Persona model.
  - Filter `persona.displayName` and `persona.systemPrompt`.
  - Return items in the same order as `PersonaGallery` if feasible: built-ins alpha, then custom alpha.
  - Keep every user-visible label as `Agents`, not `Personas`.
- [ ] `useSkillSearch(query)`:
  - Fetch with `listSkills()` on mount.
  - Use a module-level cache for immediate paint, then refresh on mount so Settings edits do not leave search stale.
  - Filter `skill.name` and `skill.description`.
  - Return `[]` while first fetch is pending; no V1 loading indicator.
- [ ] Chat search:
  - Reuse `useSessionSearch` unchanged.
  - Search visible, non-archived chat sessions, not blank home drafts.
  - Drive `setQuery` and `search(debouncedQuery)` from the debounced query so ACP message search is not spammed.

## Phase 5 — Detail Open Intents

- [ ] Add shell state for search result open intents, for example:
  - `{ type: "extension"; entry: ExtensionEntry }`
  - `{ type: "agent"; id: string }`
  - `{ type: "skill"; skill: SkillInfo }`
- [ ] Extension row click:
  - Set extension intent.
  - Open `SettingsModal` with `initialSection="extensions"`.
  - Update `SettingsModal` to accept and pass `openExtension` into `ExtensionsSettings`.
  - Update `ExtensionsSettings` to seed/open the existing `ExtensionModal` immediately from that entry, then refresh the list in the background and consume the intent.
- [ ] Agent row click:
  - Set agent intent.
  - Navigate to `"agents"`.
  - Update `AgentsView` to accept `openAgentId` backed by current persona ids and call `openPersonaEditor(persona, "details")` after personas load, then consume the intent.
- [ ] Skill row click:
  - Set skill intent.
  - Navigate to `"skills"`.
  - Update `SkillsView` to accept `openSkill` and open the existing skill edit/detail dialog immediately, then consume the intent.
- [ ] Chat row click:
  - Use existing `onSelectSearchResult(sessionId, messageId, submittedQuery)` behavior so message matches can scroll to the matched message.

## Phase 6 — Search UI Components

- [ ] Create `src/features/search/ui/SearchHeadingInput.tsx`.
  - Native `<input>`, transparent, no border.
  - `font-family: var(--font-sans-alex)`, `font-weight: 300`, `font-size: 114px`, `line-height: 0.96`, `letter-spacing: 0`.
  - Placeholder opacity `0.10`.
  - Imperative mount `focus()` support via ref.
- [ ] Create `ResultRow.tsx`.
  - Native `button type="button"`.
  - Width `222px`, title `16px/20px`, meta `10px`.
  - Hover changes text color only; no row background.
  - Keyboard focus uses `focus-visible:ring-1`.
- [ ] Create source wrappers:
  - `ChatResultRow.tsx`
  - `ExtensionResultRow.tsx`
  - `AgentResultRow.tsx`
  - `SkillResultRow.tsx`
- [ ] Create `SearchResultsCard.tsx`.
  - `259px × 512px` at Figma size, with responsive height down to `220px` before clipping.
  - White at `0.60` opacity, `rounded-[20px]`.
  - Section chip at `left: 20px`, `top: 21px`.
  - Rows container at `left: 24px`, `top: 59px`, width `222px`.
  - Scroll with `overflow-y-auto scrollbar-none`.
  - Reuse or lightly extend `BottomFade` so it works inside a responsive card without a huge 256px fade.
- [ ] Create `SearchView.tsx`.
  - Holds immediate `query`; computes `debouncedQuery`.
  - Heading position responds to immediate `query.trim()` so typing feels instant.
  - Result state responds to debounced source results.
  - Visible card slots pack from the left using a flex rail that starts at `37px` and uses the same 36px inter-card gap as the Figma-derived `37`, `332`, `627`, `922` positions.
  - Card rail top is responsive: `clamp(260px, 39vh, 374px)`.
  - Card height reserves bottom space for the fixed composer pill.
  - Empty sources render nothing and do not leave gaps.
  - Zero-match state shows centered italic muted copy in the lower half.
  - `Esc`: clear non-empty query, otherwise call `onExit`.
  - Canvas backdrop stays static; no click-to-focus handler in V1.

## Phase 7 — Tests

- [ ] Unit tests:
  - `src/features/search/lib/__tests__/filterByQuery.test.ts`
  - `src/features/search/hooks/__tests__/useExtensionSearch.test.ts`
  - `src/features/search/hooks/__tests__/useAgentSearch.test.ts`
  - `src/features/search/hooks/__tests__/useSkillSearch.test.ts`
- [ ] Component tests:
  - `src/features/search/ui/__tests__/SearchView.test.tsx`
  - Empty query renders no cards.
  - Query with partial matches packs visible source cards from the left.
  - Zero matches renders no-match message.
  - `Esc` clear/exit behavior.
  - Row click handlers call the correct navigation/open-intent callbacks.
- [ ] Shell tests where practical:
  - `Cmd+K` opens search.
  - Search icon opens search.
  - Search keeps the sidebar toggle working, hides the status bar, and keeps composer visible.
  - Extension result opens Settings → Extensions and the target extension modal.

## Phase 8 — Visual QA

- [ ] Run the smallest relevant verification first:
  - `./bin/pnpm test -- SearchView`
  - `./bin/pnpm test -- useExtensionSearch useAgentSearch useSkillSearch`
- [ ] Run `./bin/pnpm exec biome check` on touched files or `./bin/pnpm check` if the touched surface is broad.
- [ ] Start the dev app only when ready for visual validation.
- [ ] Compare against both provided screenshots at a 1440×1024 window:
  - Default state: giant placeholder centered, no cards, top bar correct, composer visible.
  - Populated state: query raised, four slots fixed, card dimensions and spacing match.
  - Source chip labels are current product labels: `Chat`, `Extensions`, `Agents`, `Skills`.
  - Sidebar can be opened on search; status bar remains absent.
  - Composer remains bottom-right and does not overlap result cards.

## Open Decisions

- [ ] Confirm whether agent/skill result clicks should open read-only details, edit dialogs, or only navigate to the list page. This plan uses the existing detail/edit affordances because they are the closest current surfaces.
- [ ] Confirm whether available extensions should open the same configure modal as enabled extensions. This plan says yes.
- [ ] Confirm whether archived chats should be excluded. This plan excludes them from universal search V1.
- [ ] Confirm whether Search should restore the user's previous sidebar visibility after exit. Current behavior keeps the normal sidebar collapsed/open state and lets the user toggle it while search is active.
