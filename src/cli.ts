#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv"; // ✅ dotenv 이름 충돌 방지
import { resolve } from "path";
import { getServerConfig } from "./config.js";
import { FigmaMcpServer } from "./server.js";

// ✅ Load .env file from working directory
loadEnv({ path: resolve(process.cwd(), ".env") });

console.log("💡 MCP CLI 시작됨");

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
    const port = parseInt(process.env.PORT || "", 10);

    if (Number.isNaN(port)) {
      console.error("❌ process.env.PORT가 설정되어 있지 않음 (Render 환경에서는 필수)");
      process.exit(1);
    }
    console.log("🔍 포트 확인:", port); // 반드시 이게 찍혀야 함
    // ✅ 템플릿 리터럴 동작 확인용 로그
    console.log(`🟢 Initializing Figma MCP Server on port ${port}`);
    console.log(`🔑 FIGMA_API_KEY: ${serverConfig.figmaApiKey ? "[loaded]" : "[missing]"}`);
    console.log("🟢 호출 시작: startHttpServer()");
    await server.startHttpServer(port);
    console.log("🟢 호출 완료: startHttpServer()");
  }
}

// ✅ Execute directly

  startServer().catch((error) => {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  });

