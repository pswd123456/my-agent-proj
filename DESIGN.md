---
version: alpha
name: Warm Workbench
description: Agent-facing design contract for the my-agent-proj web shell.
colors:
  primary: "#31C6A0"
  on-primary: "#071F1A"
  canvas: "#0F0B08"
  surface: "#201812"
  elevated: "#291F18"
  secondary: "#F6EFDF"
  muted: "#BCAC95"
  warning: "#F2BF49"
  danger: "#FF7FAC"
typography:
  display-lg:
    fontFamily: Avenir Next
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.04em
  headline-md:
    fontFamily: Avenir Next
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  body-lg:
    fontFamily: Avenir Next
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.7
  label-mono:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.18em
rounded:
  md: 0.875rem
  lg: 1.25rem
  xl: 1.75rem
  full: 999px
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
components:
  panel-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.xl}"
    padding: "{spacing.md}"
  panel-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.xl}"
    padding: "{spacing.md}"
  panel-elevated:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 20px
  button-secondary:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 20px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    height: 48px
    padding: "{spacing.sm}"
  message-user:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  message-assistant:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  session-item-idle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "{spacing.sm}"
  status-success:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs}"
  status-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.canvas}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs}"
  status-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.canvas}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs}"
---

## Overview

`my-agent-proj` does not aim for a broad consumer-style product language. The web shell should feel like a focused operator workbench: calm, dense enough for real debugging, and visually controlled enough that AI-generated screens do not drift every time a new surface appears.

The tone is **warm technical**, not cold enterprise and not playful dashboard chrome. The interface should feel like a dimly lit desk with a precise instrument panel on top: dark ink canvas, warm sand text, and one jade accent that signals action, success, and current focus.

This file is the agent-facing contract. It is intentionally thinner than the implementation in `packages/tokens` and the detailed guidance in `docs/design-system/`. When there is a conflict, runtime token values and nearby implementation constraints win.

## Colors

The system is built around a dark, warm shell with restrained highlights.

- **Canvas:** the outer shell and deepest background. It should anchor long-running workbench sessions and reduce glare.
- **Surface / Elevated:** internal panels, cards, drawers, and conversation bubbles. Elevated surfaces should feel slightly nearer without becoming glossy or neon.
- **Primary:** jade is the only strong accent. Use it for current focus, affirmative actions, and successful outcomes. Do not introduce a second competing accent.
- **Secondary:** warm sand is the primary readable foreground for body copy and high-value UI text.
- **Muted:** metadata, timestamps, supporting labels, and inspector scaffolding should step down into this quieter tone.
- **Warning / Danger:** use these only for execution state, conflict, or error signals. They are operational semantics, not branding colors.

Implementation may use alpha surfaces, `color-mix()`, and subtle overlays, but those effects should resolve back to these color anchors rather than inventing unrelated hues.

## Typography

Typography should communicate hierarchy through restraint rather than scale explosion.

- **Display / Headline:** use the sans family for page framing, top-level workbench titles, and key section headers.
- **Body:** body copy should remain relaxed and readable because the product often shows long prompts, traces, and assistant output.
- **Mono labels:** metadata, inspector labels, token names, session IDs, and small operational badges should use the mono family with uppercase tracking. This establishes a dependable "instrument panel" layer above the prose layer.

Avoid mixing multiple expressive fonts inside the shell. The contrast should come from sans versus mono, weight changes, and spacing discipline.

## Layout

The shell follows a workbench-first layout strategy.

- New screens should map to an existing page template before inventing a new arrangement.
- `ConversationPage / Workbench` is the dominant template for runtime-facing surfaces: global header on top, navigation or session context on one side, primary task flow in the center, and read-only context or inspection on the side.
- Wide screens may expose multiple panels at once, but narrow screens must stack them instead of compressing them into unusable columns.
- Spacing should stay on a tight, repeatable scale. Generous whitespace is valuable between major regions, while dense operational content inside a panel should stay compact and aligned.

The visual structure should make it obvious what is interactive now, what is reference context, and what is historical execution output.

## Elevation & Depth

Depth is conveyed through tonal layering, border restraint, and selective emphasis rather than heavy glassmorphism or glossy gradients.

- The outer shell should remain darkest.
- Primary content panels should sit on surface or elevated layers with soft separation.
- A single focused or active block may use stronger outline or accent emphasis, but nested boxes should not keep stacking borders.
- Debug and trace areas should feel inspectable, not decorative.

Use shadows sparingly and keep them soft. If a panel already has strong tonal contrast, do not add extra dramatic shadowing.

## Shapes

Rounded geometry should soften the workbench without turning it into a consumer card gallery.

- Major panels use large radii.
- Repeated interior blocks use medium-to-large radii.
- Buttons, tabs, pills, and status chips use full-pill shapes when the intent is filtering, switching, or quick action.

Avoid mixing sharp-cornered and heavily rounded components on the same surface. Keep the shape language consistent across conversation, calendar, and debug panels.

## Components

The component language should reinforce the repo's existing pattern layers rather than bypass them.

### Workbench Panels

Panels are the main containment unit. Use them to organize sections such as conversation, schedule context, and debug inspection. Prefer one clear panel boundary per region instead of multiple nested bordered boxes.

### Session Rail & Inspector

Session lists, inspector tabs, and auxiliary read-only blocks should feel quieter than the active task area. They should share the same surface family and type hierarchy, with emphasis added only for the currently selected item or active tab.

### Buttons & Inputs

Primary actions may use the jade accent, but most control surfaces should remain tonal and calm. Inputs should look integrated with the shell, not like separate white app widgets dropped onto a dark background.

### Status Presentation

Execution states should always read consistently:

- success uses the primary accent path
- warning uses amber
- failure uses danger pink

These colors should appear in chips, badges, and state text before they appear in large filled blocks.

## Do's and Don'ts

### Do

- Reuse the existing tokens, patterns, and page templates before creating a new visual direction.
- Keep the main interaction path visually strongest and push raw trace detail into quieter inspector surfaces.
- Use mono labels for operational chrome such as IDs, timestamps, tabs, and debug metadata.
- Let color signal semantics first and decoration second.

### Don'ts

- Do not introduce a second brand accent or bright rainbow status palette.
- Do not fill business pages with ad hoc `box -> box -> box` nesting just to create grouping.
- Do not use white consumer-form inputs or bright marketing gradients inside the runtime shell.
- Do not move prompt, trace, and raw tool output into the same visual layer as assistant prose unless the page is explicitly a debug surface.
