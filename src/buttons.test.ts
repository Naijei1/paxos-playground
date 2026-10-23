import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("button feedback", () => {
  it("applies hover and pressed styles outside a hover media query", () => {
    const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    expect(css).toContain(".btn:hover:not(:disabled)");
    expect(css).toContain(".btn:active:not(:disabled)");
    expect(css).toContain("cursor: pointer");
    expect(css).not.toMatch(/@media\s*\(\s*hover\s*:/);
  });
});
