import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageMarkdown } from "./message-markdown";

describe("MessageMarkdown", () => {
  test("renders core markdown blocks", () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown
        content={`# 标题

这是一个带有 [链接](https://example.com) 和 \`inline code\` 的段落。

\`\`\`ts
const answer = 42;
\`\`\``}
      />
    );

    expect(html).toContain("<h1");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("inline code");
  });

  test("renders gfm tables and task lists", () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown
        content={`| 列1 | 列2 |
| --- | --- |
| A | B |

- [x] 已完成
- [ ] 待处理`}
      />
    );

    expect(html).toContain("<table");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});
