# Project-Tinted Chat Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subtly tint the dot-grid app canvas toward the active chat's project color, gated by `activeView === "chat"`, with a 240ms cross-fade and reduced-motion respected.

**Architecture:** Single CSS-variable composition. Existing `--canvas` / `--dot-color` are renamed to `--canvas-base` / `--dot-color-base`; `.bg-dot-grid` derives its actual values from those bases mixed (in `oklch`) with a new `--project-tint` variable. A new hook `useActiveProjectTint` resolves session→project→color; `AppShell` gates by `activeView` and applies the result as an inline CSS variable on the existing `bg-dot-grid` wrapper. No new wrapper element, no overlay, no provider.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, zustand stores, vitest + `@testing-library/react`, Tauri 2 (Chromium WebView; `color-mix()` is supported).

**Spec:** `docs/superpowers/specs/2026-04-28-project-tinted-canvas-design.md`

**Branch:** `tulsi/visual-design`

**Pre-flight note:** Codex has in-flight changes on `src/app/AppShell.tsx` for the universal-search feature. **Before starting Task 4, run `git status` and verify whether codex's AppShell changes have already merged.** The tint addition is small (≈3 lines) and should rebase cleanly, but coordinate timing if both edits land in the same window.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/styles/globals.css` | Modify | Rename two tokens; rewrite `.bg-dot-grid` to use `color-mix()`; add `prefers-reduced-motion` override |
| `src/shared/ui/BottomFade.tsx` | Modify | Update default `surface` arg from `var(--canvas)` to `var(--canvas-base)` (rename ripple) |
| `src/features/chat/hooks/useActiveProjectTint.ts` | Create | Selector hook: resolves the active session's project color or `null` |
| `src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts` | Create | Unit tests for the selector hook |
| `src/app/AppShell.tsx` | Modify | Call hook, gate by `activeView === "chat"`, apply inline `--project-tint` style |

No new directories. No new dependencies.

---

## Task 1: Rename canvas tokens (mechanical, no behavior change)

**Why first:** The rename is independent of the new feature and leaves `.bg-dot-grid` working exactly as today. Doing it as its own commit makes the next commit's diff (the `color-mix()` rewrite) trivial to review.

**Files:**
- Modify: `src/shared/styles/globals.css:281` (var declaration)
- Modify: `src/shared/styles/globals.css:301` (var declaration)
- Modify: `src/shared/styles/globals.css:422` (`.bg-dot-grid` reads)
- Modify: `src/shared/styles/globals.css:425` (`.bg-dot-grid` reads)
- Modify: `src/shared/styles/globals.css:572` (`--color-canvas-alex` alias)
- Modify: `src/shared/ui/BottomFade.tsx:10` (default surface arg)

- [ ] **Step 1.1: Audit all references to the old names**

Run:
```bash
grep -rn "var(--canvas)\|var(--dot-color)\b\|--canvas:\|--dot-color:" src --include="*.css" --include="*.ts" --include="*.tsx"
```

Expected output (matches what was authored as of 2026-04-28):
```
src/shared/ui/BottomFade.tsx:10:  surface = "var(--canvas)",
src/shared/styles/globals.css:281:  --canvas: #dedede;
src/shared/styles/globals.css:301:  --dot-color: rgba(37, 37, 37, 0.15);
src/shared/styles/globals.css:422:  background-color: var(--canvas);
src/shared/styles/globals.css:425:    var(--dot-color) var(--dot-size),
src/shared/styles/globals.css:572:  --color-canvas-alex: var(--canvas);
```

If grep returns additional references (e.g., codex landed new code that reads `--canvas` directly), include them in this task too — every reference must be renamed in lockstep so the visual baseline is preserved.

- [ ] **Step 1.2: Rename the var declarations in `globals.css`**

In `src/shared/styles/globals.css`, change:
```css
--canvas: #dedede;
```
to:
```css
--canvas-base: #dedede;
```

And change:
```css
--dot-color: rgba(37, 37, 37, 0.15);
```
to:
```css
--dot-color-base: rgba(37, 37, 37, 0.15);
```

- [ ] **Step 1.3: Update the readers in `globals.css`**

Inside `.bg-dot-grid` change:
```css
background-color: var(--canvas);
background-image: radial-gradient(
  circle,
  var(--dot-color) var(--dot-size),
  transparent var(--dot-size)
);
```
to:
```css
background-color: var(--canvas-base);
background-image: radial-gradient(
  circle,
  var(--dot-color-base) var(--dot-size),
  transparent var(--dot-size)
);
```

And the alex alias:
```css
--color-canvas-alex: var(--canvas);
```
to:
```css
--color-canvas-alex: var(--canvas-base);
```

- [ ] **Step 1.4: Update `BottomFade.tsx` default arg**

In `src/shared/ui/BottomFade.tsx:10`, change:
```tsx
surface = "var(--canvas)",
```
to:
```tsx
surface = "var(--canvas-base)",
```

- [ ] **Step 1.5: Verify no stale references remain**

Run:
```bash
grep -rn "var(--canvas)\|var(--dot-color)\b\|--canvas:\|--dot-color:" src --include="*.css" --include="*.ts" --include="*.tsx"
```
Expected: **no output** (every reference now uses the `-base` suffix or is on the renamed declaration line).

Also run:
```bash
grep -rn "var(--canvas-base)\|var(--dot-color-base)\|--canvas-base:\|--dot-color-base:" src --include="*.css" --include="*.ts" --include="*.tsx"
```
Expected: 6 matches (the 5 renames in globals.css plus BottomFade.tsx).

- [ ] **Step 1.6: Run the dev server and visually confirm zero change**

Run (from `ui/goose2/`):
```bash
pnpm dev
```
Open the app, navigate Home → Chat → Projects → Agents. The dot-grid background must look identical to before this commit (same grey, same dot pattern, same density). If anything is off, you missed a reference — re-run step 1.5.

- [ ] **Step 1.7: Run unit tests**

Run:
```bash
pnpm test
```
Expected: all existing tests pass. (The rename is purely cosmetic; nothing in tests should reference these CSS var names.)

- [ ] **Step 1.8: Commit**

```bash
git add src/shared/styles/globals.css src/shared/ui/BottomFade.tsx
git commit -m "$(cat <<'EOF'
refactor(goose2): rename --canvas / --dot-color to *-base

Prepares for project-tint composition in .bg-dot-grid. No visual
change — every reader is renamed in lockstep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Compose `.bg-dot-grid` with `--project-tint` (still no behavior change)

**Why second:** The `color-mix()` rewrite is the heart of the feature. Doing it before any consumer wires up `--project-tint` means we can confirm in isolation that the un-tinted case still renders identically (the variable defaults to `transparent`, so `color-mix()` collapses to the base values).

**Files:**
- Modify: `src/shared/styles/globals.css:421-429` (`.bg-dot-grid` rule)

- [ ] **Step 2.1: Replace the `.bg-dot-grid` rule**

In `src/shared/styles/globals.css`, replace the existing block (around lines 420-429):

```css
/* Alex redesign — dot-grid canvas utility */
.bg-dot-grid {
  background-color: var(--canvas-base);
  background-image: radial-gradient(
    circle,
    var(--dot-color-base) var(--dot-size),
    transparent var(--dot-size)
  );
  background-size: var(--dot-spacing) var(--dot-spacing);
}
```

with:

```css
/* Alex redesign — dot-grid canvas utility.
   Composes a subtle project tint over the base canvas + dot color via
   color-mix(). When --project-tint is unset/transparent, both expressions
   resolve cleanly back to the base values, so non-project surfaces are
   pixel-identical to pre-tint. oklch is chosen so the perceived tint
   weight is consistent across saturated and cool palette colors. */
.bg-dot-grid {
  background-color: color-mix(
    in oklch,
    var(--project-tint, transparent) 7%,
    var(--canvas-base)
  );
  background-image: radial-gradient(
    circle,
    color-mix(
      in oklch,
      var(--project-tint, transparent) 12%,
      var(--dot-color-base)
    )
      var(--dot-size),
    transparent var(--dot-size)
  );
  background-size: var(--dot-spacing) var(--dot-spacing);
  transition:
    background-color 240ms ease,
    background-image 240ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .bg-dot-grid {
    transition: none;
  }
}
```

- [ ] **Step 2.2: Run the dev server and visually confirm zero change**

Run (from `ui/goose2/`):
```bash
pnpm dev
```
Because `--project-tint` is not set anywhere yet, every `color-mix()` resolves to its base. The canvas must look identical to Task 1's commit. If you see any color shift, the rule was misedited — re-check the syntax against the spec's Architecture section.

- [ ] **Step 2.3: Manual override smoke test (temporary)**

Open DevTools on the running app, select the root `bg-dot-grid` element, and add `--project-tint: #3b82f6` (one of the palette blues) inline. The canvas should subtly shift toward blue. Remove the override.

This step is just a confidence check that `color-mix()` is wired correctly. No code change is committed from this step.

- [ ] **Step 2.4: Run unit tests**

```bash
pnpm test
```
Expected: all existing tests still pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/shared/styles/globals.css
git commit -m "$(cat <<'EOF'
feat(goose2): compose .bg-dot-grid with --project-tint via color-mix

No behavior change yet — --project-tint is unset, so color-mix() resolves
to base values. Adds 240ms cross-fade transition with prefers-reduced-
motion override. Tinting is wired up by a later commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useActiveProjectTint` hook (TDD)

**Why third:** With the CSS plumbing in place but no consumer, the hook is the next isolatable unit. Test-first is straightforward because zustand stores expose `setState` for direct manipulation in tests (this is the pattern established in `useChatSessionController.test.ts`).

**Files:**
- Create: `src/features/chat/hooks/useActiveProjectTint.ts`
- Create: `src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts`

- [ ] **Step 3.1: Write the failing test file**

Create `src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { useProjectStore } from "@/features/projects/stores/projectStore";

import { useActiveProjectTint } from "../useActiveProjectTint";

const baseSessionState = {
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  hasHydratedSessions: true,
  contextPanelOpenBySession: {},
  activeWorkspaceBySession: {},
};

const baseProjectState = {
  projects: [],
  loading: false,
  activeProjectId: null,
};

describe("useActiveProjectTint", () => {
  beforeEach(() => {
    useChatSessionStore.setState(baseSessionState);
    useProjectStore.setState(baseProjectState);
  });

  it("returns null when there is no active session", () => {
    const { result } = renderHook(() => useActiveProjectTint());
    expect(result.current).toBeNull();
  });

  it("returns null when the active session has no projectId", () => {
    useChatSessionStore.setState({
      ...baseSessionState,
      sessions: [
        {
          id: "s1",
          title: "Chat",
          providerId: "openai",
          modelId: "gpt-4o",
          modelName: "GPT-4o",
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          messageCount: 0,
        },
      ],
      activeSessionId: "s1",
    });

    const { result } = renderHook(() => useActiveProjectTint());
    expect(result.current).toBeNull();
  });

  it("returns the project's color when the active session is in-project", () => {
    useProjectStore.setState({
      ...baseProjectState,
      projects: [
        {
          id: "p1",
          name: "Blue project",
          color: "#3b82f6",
          description: "",
          prompt: "",
          workingDirs: [],
        },
      ],
    });
    useChatSessionStore.setState({
      ...baseSessionState,
      sessions: [
        {
          id: "s1",
          title: "Chat",
          providerId: "openai",
          modelId: "gpt-4o",
          modelName: "GPT-4o",
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          messageCount: 0,
          projectId: "p1",
        },
      ],
      activeSessionId: "s1",
    });

    const { result } = renderHook(() => useActiveProjectTint());
    expect(result.current).toBe("#3b82f6");
  });

  it("returns null when the active session references a deleted project", () => {
    useChatSessionStore.setState({
      ...baseSessionState,
      sessions: [
        {
          id: "s1",
          title: "Chat",
          providerId: "openai",
          modelId: "gpt-4o",
          modelName: "GPT-4o",
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          messageCount: 0,
          projectId: "ghost-project",
        },
      ],
      activeSessionId: "s1",
    });
    // No projects in the project store.

    const { result } = renderHook(() => useActiveProjectTint());
    expect(result.current).toBeNull();
  });
});
```

> **Note on the project shape:** if `ProjectInfo` requires fields beyond `id`, `name`, `color` (check `src/features/projects/api/projects.ts`), include the missing fields in the test fixtures. The `description`/`prompt`/`workingDirs` fields above are typical; adjust to match the actual interface.

- [ ] **Step 3.2: Run the tests to verify they fail**

```bash
pnpm test src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts
```
Expected: FAIL with `Cannot find module '../useActiveProjectTint'`.

- [ ] **Step 3.3: Write the minimal hook**

Create `src/features/chat/hooks/useActiveProjectTint.ts`:

```ts
import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { useProjectStore } from "@/features/projects/stores/projectStore";

/**
 * Resolves the active chat session's project color. Returns the hex string
 * if the active session is bound to a known project, otherwise null. The
 * route gate (only-tint-when-on-chat-view) lives at the application point
 * in AppShell, not here — this hook stays a pure session→project→color
 * selector so it has one named place to test.
 */
export function useActiveProjectTint(): string | null {
  const activeSessionId = useChatSessionStore((s) => s.activeSessionId);
  const sessions = useChatSessionStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);

  if (!activeSessionId) return null;
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session?.projectId) return null;
  const project = projects.find((p) => p.id === session.projectId);
  return project?.color ?? null;
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

```bash
pnpm test src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts
```
Expected: 4 passing.

- [ ] **Step 3.5: Run the full test suite**

```bash
pnpm test
```
Expected: full suite passes (the new hook is unused by production code, so nothing else can regress yet).

- [ ] **Step 3.6: Commit**

```bash
git add src/features/chat/hooks/useActiveProjectTint.ts src/features/chat/hooks/__tests__/useActiveProjectTint.test.ts
git commit -m "$(cat <<'EOF'
feat(goose2): add useActiveProjectTint hook

Pure selector: active session → project → color (or null). Route gating
lives at the application point in AppShell. Unit-tested against the four
cases: no active session, no project on session, in-project, deleted
project.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the hook into `AppShell`

**Why fourth:** With both ends ready (CSS consumer + hook producer), the only remaining work is connecting them. This is where the route gate is enforced.

**Pre-flight:** Run `git status` and `git log --oneline -5`. If codex's universal-search work has updated `src/app/AppShell.tsx` since this plan was written, **rebase / pull first**, then re-confirm the line numbers below by re-reading `AppShell.tsx`. The change is small (≈4 lines) and should rebase cleanly, but verify before editing.

**Files:**
- Modify: `src/app/AppShell.tsx` (add hook call near top of component, gate result, apply as inline style on `bg-dot-grid` wrapper)

- [ ] **Step 4.1: Read the current state of `AppShell.tsx`**

Read `src/app/AppShell.tsx` and locate two regions:
1. The top of the component body — anywhere after `const [activeView, setActiveView] = useState<AppView>("home");` (currently line 85). This is where the new hook call goes.
2. The `bg-dot-grid` wrapper element (currently line 694). This is where the inline style goes.

If the line numbers have shifted, work from the surrounding code rather than fixed line numbers.

- [ ] **Step 4.2: Add the hook import**

In the imports block at the top of `src/app/AppShell.tsx`, add:

```tsx
import { useActiveProjectTint } from "@/features/chat/hooks/useActiveProjectTint";
```

Place it next to the other `@/features/chat/...` imports (alphabetize within the existing block to match the file's existing import-ordering convention).

- [ ] **Step 4.3: Call the hook and compute the gated tint**

Inside the `AppShell` component body, immediately after the existing `activeView` state declaration, add:

```tsx
const projectTint = useActiveProjectTint();
const tint = activeView === "chat" ? projectTint : null;
```

- [ ] **Step 4.4: Apply the inline style on the `bg-dot-grid` wrapper**

Find the wrapper element (currently `AppShell.tsx:694`):

```tsx
<div className="flex h-screen w-screen flex-col overflow-hidden bg-dot-grid text-[var(--text-default-alex)]">
```

Change it to:

```tsx
<div
  className="flex h-screen w-screen flex-col overflow-hidden bg-dot-grid text-[var(--text-default-alex)]"
  style={{ "--project-tint": tint ?? "transparent" } as React.CSSProperties}
>
```

The `as React.CSSProperties` cast is required because TypeScript's `CSSProperties` type doesn't natively accept custom CSS properties. This pattern is already used elsewhere in the codebase — match the existing style.

- [ ] **Step 4.5: Verify the dev server still renders**

```bash
pnpm dev
```
- Open the app, click into a chat that **does not** have a project. Canvas: unchanged neutral grey.
- Click into a chat that **does** have a project (or assign one via the composer's project picker). Canvas: subtly tints toward the project's color. Cross-fades on switching.
- Navigate to Home / Projects / Agents / Skills. Canvas: snaps to neutral (the `activeView` gate kicks in).
- Switch from a project chat directly to Home: canvas cross-fades from tinted to neutral.

- [ ] **Step 4.6: Run typecheck and unit tests**

```bash
pnpm exec tsc --noEmit
pnpm test
```
Expected: no type errors; all tests pass.

- [ ] **Step 4.7: Commit**

```bash
git add src/app/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(goose2): tint app canvas by active chat's project color

Wires useActiveProjectTint into AppShell, gated by activeView === "chat",
applied as an inline --project-tint CSS variable on the bg-dot-grid
wrapper. The dot-grid utility composes the tint via color-mix() over the
base canvas/dot tokens; non-project and non-chat views resolve to the
base values automatically. 240ms cross-fade, prefers-reduced-motion
respected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Visual tuning + acceptance pass

**Why fifth:** The 7%/12% mix weights in the spec are eyeball numbers. With everything wired, do a quick polish pass across the full palette before declaring the feature done.

**Files:**
- Possibly modify: `src/shared/styles/globals.css` (only the two percentage numbers in `.bg-dot-grid`)

- [ ] **Step 5.1: Visually walk all 14 palette colors**

Create a temporary project for each of the 14 `COLOR_OPTIONS` (`src/features/projects/ui/CreateProjectDialog.tsx:38-53`), or temporarily rotate the color of one project through each value. Open a chat in each project and judge:

- **Too strong?** Reduce the fill weight from `7%` toward `5%`.
- **Dots vanishing?** Increase the dot weight from `12%` toward `15%`.
- **Saturated reds/pinks/magentas (`#ef4444`, `#ec4899`, `#f43f5e`, `#a855f7`) overwhelming?** Consider lowering the fill weight (a per-color table is out of scope per the spec — pick a single global value that works across the whole palette).
- **Cool blues/teals (`#06b6d4`, `#3b82f6`, `#14b8a6`) reading as "barely there"?** Raise the dot weight slightly.

Aim for a single (fill%, dot%) pair that reads as "tasteful hint" across all 14 options. The spec's 7/12 is the starting point; expect ±2 percentage-point tweaks.

- [ ] **Step 5.2: If you changed the percentages, edit `globals.css`**

In `src/shared/styles/globals.css` `.bg-dot-grid`, update the two percentage values inside the two `color-mix()` calls. Keep `oklch` and the `var(--project-tint, transparent)` arguments unchanged.

- [ ] **Step 5.3: Verify the acceptance criteria from the spec**

Walk the spec's "Acceptance" list (`docs/superpowers/specs/2026-04-28-project-tinted-canvas-design.md`):

1. ☐ Opening a project chat tints the canvas toward that project's color, subtly.
2. ☐ Opening a No-Project chat shows the existing neutral canvas.
3. ☐ Opening a non-chat route (Home, Projects, Agents, Skills, Search) shows the existing neutral canvas, even if a project-bound session is still in the chat session store.
4. ☐ Switching between sessions in different projects cross-fades over ~240ms.
5. ☐ macOS System Settings → Accessibility → Display → "Reduce motion" turned on → tint applies instantly (no cross-fade).
6. ☐ No visual change to non-canvas surfaces: sidebar rows, chat card interior, input pill, context panel, modals.
7. ☐ All existing tests pass (`pnpm test`); new unit tests pass.

For (5), toggle "Reduce motion" in macOS System Settings to verify — this affects the `prefers-reduced-motion` media query.

- [ ] **Step 5.4: Run the full check pipeline**

```bash
pnpm check
pnpm test
```
Expected: all green.

- [ ] **Step 5.5: Commit (only if percentages changed in 5.2)**

If you adjusted the percentages:

```bash
git add src/shared/styles/globals.css
git commit -m "$(cat <<'EOF'
chore(goose2): tune project-tint mix weights after visual review

Adjusted fill/dot weights in .bg-dot-grid after walking all 14 palette
colors. Saturated and cool hues now read with consistent perceived
weight.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no adjustment was needed, skip the commit — the spec values held up.

---

## Decision: no shell-level AppShell component test

The spec's `Testing → Component — AppShell` section listed shell-rendering assertions on the inline `--project-tint` style. After review, this is **dropped** in favor of:

- The four-case unit test on `useActiveProjectTint` (Task 3), which covers the resolution rule.
- The acceptance walkthrough in Task 5.3, which exercises the route gate (`activeView === "chat"`) end-to-end in the real shell.

**Reasoning:** The gate logic is one ternary. AppShell's existing test posture (see `src/app/App.test.tsx` — it mocks `AppShell` out entirely) means a shell-rendering test would require a large mock surface for many heavy children (Sidebar, ChatView, TopBar, modals, settings) to assert a single attribute. The cost-to-confidence ratio is unfavorable; the hook test plus the manual acceptance pass cover the same ground at a fraction of the cost.

If a future change makes the gate logic non-trivial (e.g., a per-route override map, dark-mode branching), revisit this decision and either extract the gate into a pure helper or add a shell test at that point.

---

## Optional: E2E test (low priority)

The spec lists E2E coverage as optional. If desired, add a Playwright test that:

1. Creates a project with a known color (e.g., `#3b82f6`).
2. Opens a chat in that project.
3. Asserts the computed value of `--project-tint` on the root `bg-dot-grid` element matches `#3b82f6`.
4. Navigates to Home.
5. Asserts the computed value of `--project-tint` is `transparent`.

Existing Playwright fixtures live under `tests/e2e/` and use `tests/e2e/fixtures/tauri-mock.ts` — follow that pattern. This is **not required** for the feature to merge.

---

## What this plan does not cover (per spec non-goals)

- Tinting inside the chat card or input pill.
- Per-color intensity tuning table.
- A user-facing toggle.
- Changes to `COLOR_OPTIONS` in the project color picker.
- Dark-mode tint values (deferred).
- Fixing the unrelated pre-commit-hook bug where biome rejects `.md`-only commits (filed mentally during the spec commit; out of scope here).
