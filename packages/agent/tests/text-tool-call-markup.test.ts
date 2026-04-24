import { describe, expect, test } from "bun:test";

import { stripTextToolCallMarkup } from "../src/runtime/blocks.js";

describe("stripTextToolCallMarkup", () => {
  test("removes pure tool call markup", () => {
    expect(
      stripTextToolCallMarkup(
        '[TOOL_CALL]\n{tool => "list_directory", args => {\n  --path "."\n}}\n[/TOOL_CALL]'
      )
    ).toBe("");
  });

  test("keeps surrounding natural language", () => {
    expect(
      stripTextToolCallMarkup(
        '先看一下。\n\n[TOOL_CALL]\n{tool => "list_directory", args => {\n  --path "."\n}}\n[/TOOL_CALL]\n\n看完再说。'
      )
    ).toBe("先看一下。\n\n看完再说。");
  });
});
