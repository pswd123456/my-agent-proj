import { z } from "zod";

const { McpServer, StdioServerTransport } = await import(
  "../../src/mcp/sdk-loader.js"
).then((module) => module.loadMcpSdkRuntime());

const server = new McpServer({
  name: "fixture-stdio",
  version: "1.0.0"
});

server.registerTool(
  "echo",
  {
    description: "Echo the provided message.",
    inputSchema: {
      message: z.string()
    }
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: `echo:${message}`
      }
    ]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
