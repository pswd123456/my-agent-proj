import { createMiniMaxRuntime } from "../packages/agent/src/model.ts";

const runtime = createMiniMaxRuntime(process.env);

if (!runtime) {
  console.error(
    "Missing API key. Set API_KEY, MINIMAX_API_KEY, or ANTHROPIC_API_KEY in .env."
  );
  process.exit(1);
}

const message = await runtime.client.messages.create({
  model: runtime.model,
  max_tokens: 128,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Reply with exactly: pong"
        }
      ]
    }
  ],
  system: "You are a ping smoke test.",
  tools: []
});

const textChunks: string[] = [];
const contentTypes: string[] = [];
for (const block of message.content) {
  contentTypes.push(block.type);
  if (block.type === "text") {
    textChunks.push(block.text);
  }
}

const text = textChunks.join("\n").trim();

console.log(
  JSON.stringify(
    {
      ok: true,
      model: runtime.model,
      stopReason: message.stop_reason ?? null,
      contentTypes,
      text: text || null
    },
    null,
    2
  )
);
