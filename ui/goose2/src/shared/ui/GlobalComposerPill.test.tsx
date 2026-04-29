import { render, screen, fireEvent } from "@testing-library/react";
import type { ProviderInventoryEntryDto } from "@aaif/goose-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStore } from "@/features/agents/stores/agentStore";
import { useProviderInventoryStore } from "@/features/providers/stores/providerInventoryStore";
import { GlobalComposerPill } from "./GlobalComposerPill";

const mockGetProviderInventory = vi.fn();
const mockGooseConfigRead = vi.fn();

vi.mock("@/features/providers/api/inventory", () => ({
  getProviderInventory: (...args: unknown[]) =>
    mockGetProviderInventory(...args),
}));

vi.mock("@/shared/api/acpConnection", () => ({
  getClient: () =>
    Promise.resolve({
      goose: {
        GooseConfigRead: mockGooseConfigRead,
      },
    }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function makeInventoryEntry(
  entry: Pick<
    ProviderInventoryEntryDto,
    "providerId" | "providerName" | "configured" | "refreshing" | "models"
  >,
): ProviderInventoryEntryDto {
  return {
    description: "",
    defaultModel: "",
    providerType: "Preferred",
    configKeys: [],
    setupSteps: [],
    supportsRefresh: false,
    stale: false,
    ...entry,
  };
}

describe("GlobalComposerPill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockGetProviderInventory.mockResolvedValue([]);
    mockGooseConfigRead.mockResolvedValue({ value: null });
    useAgentStore.setState({
      selectedProvider: "goose",
      providers: [],
      providersLoading: false,
    });
    useProviderInventoryStore.setState({
      entries: new Map(),
      loading: false,
    });
  });

  it("renders the universal 'Start a conversation' placeholder", () => {
    render(<GlobalComposerPill onSend={vi.fn()} />);
    expect(
      screen.getByPlaceholderText(/start a conversation/i),
    ).toBeInTheDocument();
  });

  it("calls onSend with the typed text when send is clicked", () => {
    const onSend = vi.fn();
    render(<GlobalComposerPill onSend={onSend} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send when input is empty", () => {
    const onSend = vi.fn();
    render(<GlobalComposerPill onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("lists configured inventory models in the model picker", async () => {
    useProviderInventoryStore.setState({
      entries: new Map([
        [
          "anthropic",
          makeInventoryEntry({
            providerId: "anthropic",
            providerName: "Anthropic",
            configured: true,
            refreshing: false,
            models: [
              {
                id: "claude-opus-4",
                name: "Claude Opus 4",
                recommended: false,
              },
              {
                id: "claude-sonnet-4",
                name: "Claude Sonnet 4",
                recommended: true,
              },
            ],
          }),
        ],
      ]),
    });

    render(<GlobalComposerPill onSend={vi.fn()} />);

    fireEvent.focus(screen.getByRole("textbox"));
    fireEvent.click(screen.getByRole("button", { name: /select model/i }));

    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    expect(await screen.findAllByText("Claude Sonnet 4")).not.toHaveLength(0);
    expect(screen.getByText("Claude Opus 4")).toBeInTheDocument();
  });

  it("sends the selected model override with the composed message", async () => {
    useProviderInventoryStore.setState({
      entries: new Map([
        [
          "anthropic",
          makeInventoryEntry({
            providerId: "anthropic",
            providerName: "Anthropic",
            configured: true,
            refreshing: false,
            models: [
              {
                id: "claude-sonnet-4",
                name: "Claude Sonnet 4",
                recommended: true,
              },
            ],
          }),
        ],
      ]),
    });
    const onSend = vi.fn();
    render(<GlobalComposerPill onSend={onSend} />);

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /select model/i }));
    fireEvent.click(await screen.findByRole("button", { name: /claude/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("hello", {
      providerId: "anthropic",
      modelId: "claude-sonnet-4",
      modelName: "Claude Sonnet 4",
    });
  });
});
