interface ToolDescriptionSectionInput {
  heading: string;
  lines: string[];
}

function normalizeDescriptionLine(line: string): string {
  return line.trim();
}

function buildSection(input: ToolDescriptionSectionInput): string {
  const lines = input.lines
    .map(normalizeDescriptionLine)
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }

  return [input.heading, ...lines.map((line) => `- ${line}`)].join("\n");
}

export function buildToolDescription(input: {
  usageScenarios: string[];
  usageInstructions: string[];
  constraints: string[];
  examples: Array<Record<string, unknown> | string>;
}): string {
  const sections = [
    buildSection({
      heading: "1. Usage scenarios / goals",
      lines: input.usageScenarios
    }),
    buildSection({
      heading: "2. Usage instructions",
      lines: input.usageInstructions
    }),
    buildSection({
      heading: "3. Constraints / cautions",
      lines: input.constraints
    }),
    buildSection({
      heading: "4. Few-shot examples (Examples:)",
      lines: input.examples.map((example) =>
        typeof example === "string" ? example : JSON.stringify(example)
      )
    })
  ].filter((section) => section.length > 0);

  return sections.join("\n\n");
}

export function describeObjectProperty(input: {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}): string {
  return `${input.name} (${input.type}${input.required ? ", required" : ", optional"}): ${input.description}`;
}
