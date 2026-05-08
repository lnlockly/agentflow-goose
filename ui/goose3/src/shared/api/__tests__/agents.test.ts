import { describe, it, expect } from "vitest";
import {
  exportPersona,
  importPersonas,
  refreshPersonas,
  listPersonas,
  createPersona,
} from "../agents";

// goose3: persona/agents APIs are stubbed because there is no ACP
// equivalent yet. The only behaviour we still test is that read-style
// calls return safe empty defaults and write-style calls reject.

describe("agents API (goose3 stubs)", () => {
  it("listPersonas returns an empty array", async () => {
    await expect(listPersonas()).resolves.toEqual([]);
  });

  it("refreshPersonas returns an empty array", async () => {
    await expect(refreshPersonas()).resolves.toEqual([]);
  });

  it("exportPersona rejects with a not-supported error", async () => {
    await expect(exportPersona("persona-123")).rejects.toThrow(
      /not available in goose3/,
    );
  });

  it("importPersonas rejects with a not-supported error", async () => {
    await expect(importPersonas([1, 2, 3], "test.json")).rejects.toThrow(
      /not available in goose3/,
    );
  });

  it("createPersona rejects with a not-supported error", async () => {
    await expect(
      createPersona({
        displayName: "x",
      } as never),
    ).rejects.toThrow(/not available in goose3/);
  });
});
