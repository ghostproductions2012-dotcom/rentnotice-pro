// Regression test for the desktop empty-main-pane bug: the Tauri build uses a
// relative Vite base ("./"), and passing that (as ".") to wouter's router base
// made every route unmatchable — the app shell rendered but the main pane was
// permanently empty. The router base must always be an absolute path or "".
import { describe, expect, it } from "vitest";
import { computeRouterBase } from "./router-base";

describe("computeRouterBase", () => {
  it("strips the trailing slash from the hosted web base", () => {
    expect(computeRouterBase("/app/")).toBe("/app");
  });

  it("maps the desktop relative base './' to the root base", () => {
    expect(computeRouterBase("./")).toBe("");
  });

  it("maps a bare '.' to the root base", () => {
    expect(computeRouterBase(".")).toBe("");
  });

  it("keeps root '/' as empty base", () => {
    expect(computeRouterBase("/")).toBe("");
  });

  it("never returns a relative base (would break all routing)", () => {
    for (const base of ["./", ".", "", "app/", "../x/"]) {
      expect(computeRouterBase(base).startsWith(".")).toBe(false);
    }
  });
});
