"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageMarkdownProps {
  content: string;
  className?: string;
}

function mergeClassName(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function MessageMarkdown({ content, className }: MessageMarkdownProps) {
  return (
    <div
      className={mergeClassName(
        "min-w-0 text-sm leading-7 text-inherit [overflow-wrap:anywhere]",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, className: headingClassName, ...props }) => (
            <h1
              className={mergeClassName(
                "mt-5 text-xl font-semibold tracking-[-0.03em] text-[var(--app-text-primary)] first:mt-0",
                headingClassName
              )}
              {...props}
            />
          ),
          h2: ({ node: _node, className: headingClassName, ...props }) => (
            <h2
              className={mergeClassName(
                "mt-5 text-lg font-semibold tracking-[-0.02em] text-[var(--app-text-primary)] first:mt-0",
                headingClassName
              )}
              {...props}
            />
          ),
          h3: ({ node: _node, className: headingClassName, ...props }) => (
            <h3
              className={mergeClassName(
                "mt-4 text-base font-semibold text-[var(--app-text-primary)] first:mt-0",
                headingClassName
              )}
              {...props}
            />
          ),
          p: ({ node: _node, className: paragraphClassName, ...props }) => (
            <p
              className={mergeClassName(
                "mt-3 first:mt-0 whitespace-pre-wrap",
                paragraphClassName
              )}
              {...props}
            />
          ),
          ul: ({ node: _node, className: listClassName, ...props }) => (
            <ul
              className={mergeClassName(
                "mt-3 list-disc space-y-1 pl-6 first:mt-0",
                listClassName
              )}
              {...props}
            />
          ),
          ol: ({ node: _node, className: listClassName, ...props }) => (
            <ol
              className={mergeClassName(
                "mt-3 list-decimal space-y-1 pl-6 first:mt-0",
                listClassName
              )}
              {...props}
            />
          ),
          li: ({ node: _node, className: itemClassName, ...props }) => (
            <li
              className={mergeClassName(
                "pl-1 marker:text-[var(--app-text-muted)]",
                itemClassName
              )}
              {...props}
            />
          ),
          a: ({ node: _node, className: anchorClassName, ...props }) => (
            <a
              className={mergeClassName(
                "text-[var(--app-accent)] underline decoration-[color:color-mix(in_srgb,var(--app-accent)_45%,transparent)] underline-offset-4 transition hover:text-[var(--app-text-primary)]",
                anchorClassName
              )}
              {...props}
              rel="noreferrer"
              target="_blank"
            />
          ),
          blockquote: ({
            node: _node,
            className: quoteClassName,
            ...props
          }) => (
            <blockquote
              className={mergeClassName(
                "mt-4 border-l-2 border-[var(--app-border-accent)] pl-4 text-[var(--app-text-muted)] first:mt-0",
                quoteClassName
              )}
              {...props}
            />
          ),
          hr: ({ node: _node, className: ruleClassName, ...props }) => (
            <hr
              className={mergeClassName(
                "my-4 border-0 border-t border-[var(--app-border-subtle)]",
                ruleClassName
              )}
              {...props}
            />
          ),
          table: ({ node: _node, className: tableClassName, ...props }) => (
            <div className="mt-4 overflow-x-auto first:mt-0">
              <table
                className={mergeClassName(
                  "min-w-full border-collapse text-left text-sm",
                  tableClassName
                )}
                {...props}
              />
            </div>
          ),
          thead: ({ node: _node, className: sectionClassName, ...props }) => (
            <thead
              className={mergeClassName(
                "border-b border-[var(--app-border-strong)] text-[var(--app-text-primary)]",
                sectionClassName
              )}
              {...props}
            />
          ),
          tbody: ({ node: _node, className: sectionClassName, ...props }) => (
            <tbody
              className={mergeClassName(
                "[&_tr:not(:last-child)]:border-b [&_tr:not(:last-child)]:border-[var(--app-border-subtle)]",
                sectionClassName
              )}
              {...props}
            />
          ),
          th: ({ node: _node, className: cellClassName, ...props }) => (
            <th
              className={mergeClassName("px-3 py-2 font-medium", cellClassName)}
              {...props}
            />
          ),
          td: ({ node: _node, className: cellClassName, ...props }) => (
            <td
              className={mergeClassName(
                "px-3 py-2 align-top text-[var(--app-text-secondary)]",
                cellClassName
              )}
              {...props}
            />
          ),
          pre: ({ node: _node, className: preClassName, ...props }) => (
            <pre
              className={mergeClassName(
                "mt-4 overflow-x-auto rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_88%,var(--app-bg-surface)_12%)] px-3 py-3 text-xs leading-6 text-[var(--app-text-primary)] first:mt-0",
                preClassName
              )}
              {...props}
            />
          ),
          code: ({
            node: _node,
            className: codeClassName,
            children,
            ...props
          }) => {
            const isInline = !codeClassName?.includes("language-");

            if (isInline) {
              return (
                <code
                  className={mergeClassName(
                    "rounded-[0.4rem] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--app-text-primary)]",
                    codeClassName
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={mergeClassName("font-mono", codeClassName)}
                {...props}
              >
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
