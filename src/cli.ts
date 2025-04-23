#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv"; // ✅ dotenv 이름 충돌 방지
import { resolve } from "path";
import { getServerConfig } from "./config.js";
import { FigmaMcpServer } from "./server.js";

// ✅ Load .env file from working directory
loadEnv({ path: resolve(process.cwd(), ".env") });

export async function startServer(): Promise<void> {
  // ✅ Check CLI vs HTTP
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");

  // ✅ getServerConfig safely (no variable shadowing)
  const serverConfig = getServerConfig(isStdioMode);
  const server = new FigmaMcpServer(serverConfig.figmaApiKey);

  if (isStdioMode) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    const port = Number(process.env.PORT) || serverConfig.port || 3333;

    // ✅ 템플릿 리터럴 동작 확인용 로그
    console.log(`🟢 Initializing Figma MCP Server on port ${port}`);
    console.log(`🔑 FIGMA_API_KEY: ${serverConfig.figmaApiKey ? "[loaded]" : "[missing]"}`);
    console.log("🟢 호출 시작: startHttpServer()");
    await server.startHttpServer(port);
    console.log("🟢 호출 완료: startHttpServer()");
  }
}

// ✅ Execute directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer().catch((error) => {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  });
}
