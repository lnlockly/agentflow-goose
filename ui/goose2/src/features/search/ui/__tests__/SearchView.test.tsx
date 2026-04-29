import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSearchResult } from "../../hooks/useExtensionSearch";
import { SearchView } from "../SearchView";

const mockSetChatQuery = vi.fn();
const mockRunChatSearch = vi.fn();
const mockClearChatSearch = vi.fn();
let extensionResults: ExtensionSearchResult[] = [];

vi.mock("@/features/chat/stores/chatSessionStore", () => ({
  getVisibleSessions: (sessions: unknown[]) => sessions,
  useChatSessionStore: (
    selector: (state: { sessions: unknown[] }) => unknown,
  ) => selector({ sessions: [] }),
}));

vi.mock("@/features/chat/stores/chatStore", () => ({
  useChatStore: (selector: (state: { messagesBySession: object }) => unknown) =>
    selector({ messagesBySession: {} }),
}));

vi.mock("@/features/agents/stores/agentStore", () => ({
  useAgentStore: (selector: (state: { personas: unknown[] }) => unknown) =>
    selector({ personas: [] }),
}));

vi.mock("@/features/projects/stores/projectStore", () => ({
  useProjectStore: (selector: (state: { projects: unknown[] }) => unknown) =>
    selector({ projects: [] }),
}));

vi.mock("@/features/sessions/hooks/useSessionSearch", () => ({
  useSessionSearch: () => ({
    clear: mockClearChatSearch,
    isSearching: false,
    results: [],
    search: mockRunChatSearch,
    setQuery: mockSetChatQuery,
    submittedQuery: "",
  }),
}));

vi.mock("@/shared/hooks/useDebouncedValue", () => ({
  useDebouncedValue: (value: string) => value,
}));

vi.mock("../../hooks/useExtensionSearch", () => ({
  useExtensionSearch: () => extensionResults,
}));

vi.mock("../../hooks/useAgentSearch", () => ({
  useAgentSearch: () => [],
}));

vi.mock("../../hooks/useSkillSearch", () => ({
  useSkillSearch: () => [],
}));

describe("SearchView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionResults = [];
  });

  it("renders only the heading for an empty query", () => {
    render(
      <SearchView
        onExit={vi.fn()}
        onSelectSearchResult={vi.fn()}
        onOpenExtension={vi.fn()}
        onOpenAgent={vi.fn()}
        onOpenSkill={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/universal search/i)).toHaveStyle({
      top: "calc(50% - 90px)",
    });
    expect(screen.queryByText("Extensions")).not.toBeInTheDocument();
  });

  it("packs extension results into the first visible slot and opens the extension", async () => {
    const onOpenExtension = vi.fn();
    extensionResults = [
      {
        state: "enabled",
        entry: {
          config_key: "github",
          enabled: true,
          type: "stdio",
          name: "github",
          description: "Repository tools",
          cmd: "github",
          args: [],
        },
      },
    ];

    render(
      <SearchView
        onExit={vi.fn()}
        onSelectSearchResult={vi.fn()}
        onOpenExtension={onOpenExtension}
        onOpenAgent={vi.fn()}
        onOpenSkill={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/universal search/i), {
      target: { value: "git" },
    });

    await waitFor(() => {
      expect(screen.getByText("Extensions")).toBeInTheDocument();
    });

    expect(screen.getByTestId("search-results-rail")).toHaveStyle({
      left: "37px",
    });

    fireEvent.click(screen.getByRole("button", { name: /open extension/i }));
    expect(onOpenExtension).toHaveBeenCalledWith(
      expect.objectContaining({ config_key: "github" }),
    );
  });

  it("clears a non-empty query on Escape before exiting", async () => {
    const onExit = vi.fn();

    render(
      <SearchView
        onExit={onExit}
        onSelectSearchResult={vi.fn()}
        onOpenExtension={vi.fn()}
        onOpenAgent={vi.fn()}
        onOpenSkill={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/universal search/i);
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(mockClearChatSearch).toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
