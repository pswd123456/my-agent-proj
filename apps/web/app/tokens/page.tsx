import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { PageFrame } from "@ai-app-template/ui-patterns";
import {
  foundation,
  semantic,
  tokenSections,
  type TokenItem,
  type TokenSection
} from "@ai-app-template/tokens";

export const metadata: Metadata = {
  title: "Tokens",
  description: "Design tokens reference for the Web MVP."
};

const principles = [
  "页面和组件优先使用语义 token，基础 token 只在 theme 映射或系统层使用。",
  "新增 token 前先判断是否已有 token 能覆盖，或者更适合通过组件 variant 解决。",
  "页面中尽量不出现裸 hex、裸 px、临时阴影值，避免设计系统逐步漂移。",
  "如果只是单页特例，不应新增全局 token。"
] as const;

const admissionChecks = [
  "是否已有 token 可以覆盖当前需求",
  "这是不是单页面的局部特例",
  "更适合通过组件 variant 而不是全局 token 解决吗",
  "是否需要同步到 Figma 变量或设计文档"
] as const;

const layerHighlights = [
  {
    title: "Foundation",
    body: "基础层提供原子级色板、排版、间距、圆角、阴影和系统数值，服务于 theme 映射与系统实现。"
  },
  {
    title: "Semantic",
    body: "语义层把基础 token 组合成页面和组件能直接消费的角色，例如 `color.text.primary`、`surface.panel`。"
  }
] as const;

function toCssVariableName(name: string) {
  return `--preview-${name.replace(/\./g, "-")}`;
}

function getPreviewStyle(
  section: TokenSection,
  token: TokenItem
): CSSProperties {
  switch (section.presentation) {
    case "color":
      return {
        [toCssVariableName(token.name)]: String(token.value),
        background: String(token.value)
      };
    case "shadow":
      return {
        [toCssVariableName(token.name)]: String(token.value),
        boxShadow: String(token.value),
        background: semantic.surface.card.background
      };
    case "space":
      return {
        [toCssVariableName(token.name)]: String(token.value),
        width: String(token.value),
        background: semantic.color.status.success
      };
    case "typography":
      if (token.name === "typography.fontFamily.sans") {
        return { fontFamily: foundation.typography.fontFamily.sans };
      }

      if (token.name === "typography.fontFamily.mono") {
        return { fontFamily: foundation.typography.fontFamily.mono };
      }

      if (token.name === "typography.fontSize.56") {
        return {
          fontSize: foundation.typography.fontSize[40],
          lineHeight: foundation.typography.lineHeight.tight
        };
      }

      if (token.name === "typography.fontSize.18") {
        return {
          fontSize: foundation.typography.fontSize[18],
          lineHeight: foundation.typography.lineHeight.relaxed
        };
      }

      if (token.name === "typography.eyebrow") {
        return {
          fontFamily: semantic.typography.eyebrow.fontFamily,
          fontSize: semantic.typography.eyebrow.fontSize,
          letterSpacing: semantic.typography.eyebrow.letterSpacing,
          textTransform: "uppercase"
        };
      }

      if (token.name === "typography.title") {
        return {
          fontFamily: semantic.typography.title.fontFamily,
          fontSize: foundation.typography.fontSize[32],
          fontWeight: semantic.typography.title.fontWeight,
          lineHeight: semantic.typography.title.lineHeight,
          letterSpacing: semantic.typography.title.letterSpacing
        };
      }

      if (token.name === "typography.body") {
        return {
          fontFamily: semantic.typography.body.fontFamily,
          fontSize: semantic.typography.body.fontSize,
          lineHeight: semantic.typography.body.lineHeight
        };
      }

      if (token.name === "typography.caption") {
        return {
          fontFamily: semantic.typography.caption.fontFamily,
          fontSize: semantic.typography.caption.fontSize,
          letterSpacing: semantic.typography.caption.letterSpacing,
          textTransform: "uppercase"
        };
      }

      return {};
    default:
      return {};
  }
}

function renderPreview(section: TokenSection, token: TokenItem) {
  const style = getPreviewStyle(section, token);

  if (section.presentation === "color") {
    return <div className="token-swatch" style={style} />;
  }

  if (section.presentation === "space") {
    return (
      <div className="flex items-center gap-3">
        <div className="token-space-preview" style={style} />
        <span className="token-caption">spacing sample</span>
      </div>
    );
  }

  if (section.presentation === "shadow") {
    return <div className="token-shadow-preview" style={style} />;
  }

  if (section.presentation === "typography") {
    return (
      <div className="token-typography-preview" style={style}>
        Aa Bb 0123
      </div>
    );
  }

  if (token.name.startsWith("radius.")) {
    return (
      <div
        className="token-value-preview"
        style={{
          borderRadius: String(token.value),
          background: semantic.surface.card.background
        }}
      />
    );
  }

  if (token.name.startsWith("opacity.")) {
    return (
      <div className="flex items-center gap-3">
        <div
          className="token-value-preview"
          style={{
            opacity: Number(token.value),
            background: semantic.color.status.success
          }}
        />
        <span className="token-caption">visibility sample</span>
      </div>
    );
  }

  return (
    <div className="token-value-pill">
      <span>{String(token.value)}</span>
    </div>
  );
}

function TokenTable({ section }: { section: TokenSection }) {
  return (
    <article className="token-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="token-layer-label">{section.layer}</p>
          <h2 className="token-section-title">{section.title}</h2>
          <p className="token-support">{section.description}</p>
        </div>
        <span className="token-chip">{section.category}</span>
      </div>
      <div className="mt-8 grid gap-4">
        {section.tokens.map((token) => (
          <div key={token.name} className="token-row">
            <div className="token-row-preview">
              {renderPreview(section, token)}
            </div>
            <div className="min-w-0">
              <p className="token-name">{token.name}</p>
              <p className="token-support">{token.usage}</p>
            </div>
            <div className="token-meta">{String(token.value)}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function TokensPage() {
  const foundationSections = tokenSections.filter(
    (section) => section.layer === "foundation"
  );
  const semanticSections = tokenSections.filter(
    (section) => section.layer === "semantic"
  );

  return (
    <main>
      <PageFrame
        eyebrow="Design system / tokens"
        title="A shared visual source of truth for the web shell."
        description="这页把基础 token、语义 token 与使用原则放到同一个参考面板里，确保页面、组件和 AI 生成都沿着同一套视觉契约前进。"
      >
        <div className="flex flex-col gap-8">
          <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="token-hero-card">
              <p className="token-hero-kicker">What this page does</p>
              <div className="grid gap-4 md:grid-cols-2">
                {layerHighlights.map((item) => (
                  <div key={item.title} className="token-inset">
                    <h2 className="token-card-title">{item.title}</h2>
                    <p className="token-support">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <aside className="token-panel">
              <p className="token-layer-label">Snapshot</p>
              <div className="mt-5 grid gap-3">
                <div className="token-inset">
                  <p className="token-card-title">{tokenSections.length}</p>
                  <p className="token-support">
                    展示分组，直接映射 foundation 与 semantic 两层。
                  </p>
                </div>
                <div className="token-inset">
                  <p className="token-card-title">10 categories</p>
                  <p className="token-support">
                    color、typography、space、radius、shadow、border、opacity、motion、z-index、breakpoint
                  </p>
                </div>
              </div>
            </aside>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="grid gap-4">
              {foundationSections.map((section) => (
                <TokenTable key={section.id} section={section} />
              ))}
            </div>
            <div className="grid gap-4">
              {semanticSections.map((section) => (
                <TokenTable key={section.id} section={section} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="token-panel">
              <p className="token-layer-label">Usage principles</p>
              <h2 className="token-section-title">
                Prefer semantic tokens in pages and components.
              </h2>
              <div className="mt-6 grid gap-3">
                {principles.map((item) => (
                  <div key={item} className="token-rule">
                    <span className="token-rule-dot" />
                    <p className="token-support">{item}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className="token-panel">
              <p className="token-layer-label">Admission checks</p>
              <h2 className="token-section-title">
                新增 token 前先做四个判断。
              </h2>
              <div className="mt-6 grid gap-3">
                {admissionChecks.map((item, index) => (
                  <div key={item} className="token-rule">
                    <span className="token-step">{index + 1}</span>
                    <p className="token-support">{item}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </PageFrame>
    </main>
  );
}
