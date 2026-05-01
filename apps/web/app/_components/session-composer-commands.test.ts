import { describe, expect, test } from "bun:test";

import {
  filterComposerSlashCommands,
  getNextComposerSuggestionIndex,
  getComposerSuggestionRefreshIndex,
  getActiveComposerCommandToken,
  replaceComposerCommandToken
} from "./session-composer-commands";

describe("session composer commands", () => {
  test("detects slash commands at the current caret token", () => {
    expect(
      getActiveComposerCommandToken({
        value: "/pl",
        selectionStart: 3,
        selectionEnd: 3
      })
    ).toEqual({
      kind: "slash",
      trigger: "/",
      query: "pl",
      tokenStart: 0,
      tokenEnd: 3
    });
  });

  test("detects file and skill references after whitespace", () => {
    expect(
      getActiveComposerCommandToken({
        value: "read @src/app",
        selectionStart: "read @src/app".length,
        selectionEnd: "read @src/app".length
      })
    ).toMatchObject({
      kind: "file",
      query: "src/app"
    });

    expect(
      getActiveComposerCommandToken({
        value: "use #repo_reader",
        selectionStart: "use #repo_reader".length,
        selectionEnd: "use #repo_reader".length
      })
    ).toMatchObject({
      kind: "skill",
      query: "repo_reader"
    });
  });

  test("ignores slash-like text inside normal paths", () => {
    expect(
      getActiveComposerCommandToken({
        value: "docs/plan-mode.md",
        selectionStart: "docs/plan-mode.md".length,
        selectionEnd: "docs/plan-mode.md".length
      })
    ).toBeNull();
  });

  test("replaces a token and appends a trailing space for visible references", () => {
    const token = getActiveComposerCommandToken({
      value: "inspect @app",
      selectionStart: "inspect @app".length,
      selectionEnd: "inspect @app".length
    });
    expect(token).not.toBeNull();

    expect(
      replaceComposerCommandToken({
        value: "inspect @app",
        token: token!,
        replacement: "@apps/web/app/page.tsx"
      })
    ).toEqual({
      value: "inspect @apps/web/app/page.tsx ",
      nextSelection: "inspect @apps/web/app/page.tsx ".length
    });
  });

  test("removes /plan completely after the command runs", () => {
    const token = getActiveComposerCommandToken({
      value: "/plan",
      selectionStart: 5,
      selectionEnd: 5
    });
    expect(token).not.toBeNull();

    expect(
      replaceComposerCommandToken({
        value: "/plan",
        token: token!,
        replacement: ""
      })
    ).toEqual({
      value: "",
      nextSelection: 0
    });
  });

  test("filters slash commands by partial name", () => {
    expect(filterComposerSlashCommands("pl").map((item) => item.id)).toEqual([
      "plan"
    ]);
    expect(filterComposerSlashCommands("missing")).toEqual([]);
  });

  test("wraps keyboard navigation across suggestion items", () => {
    expect(
      getNextComposerSuggestionIndex({
        currentIndex: 0,
        itemCount: 3,
        direction: "down"
      })
    ).toBe(1);
    expect(
      getNextComposerSuggestionIndex({
        currentIndex: 2,
        itemCount: 3,
        direction: "down"
      })
    ).toBe(0);
    expect(
      getNextComposerSuggestionIndex({
        currentIndex: 0,
        itemCount: 3,
        direction: "up"
      })
    ).toBe(2);
    expect(
      getNextComposerSuggestionIndex({
        currentIndex: 0,
        itemCount: 0,
        direction: "up"
      })
    ).toBe(0);
  });

  test("keeps the active suggestion stable across equivalent refreshes", () => {
    expect(
      getComposerSuggestionRefreshIndex({
        currentIndex: 1,
        previousItems: [
          { key: "skill:first" },
          { key: "skill:repo_reader" },
          { key: "skill:third" }
        ],
        nextItems: [
          { key: "skill:first" },
          { key: "skill:repo_reader" },
          { key: "skill:third" }
        ]
      })
    ).toBe(1);
  });

  test("clamps the active suggestion when a refresh removes the selected item", () => {
    expect(
      getComposerSuggestionRefreshIndex({
        currentIndex: 2,
        previousItems: [
          { key: "skill:first" },
          { key: "skill:second" },
          { key: "skill:third" }
        ],
        nextItems: [{ key: "skill:first" }, { key: "skill:second" }]
      })
    ).toBe(1);
  });
});
