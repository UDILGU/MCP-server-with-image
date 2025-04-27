import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaService } from "./services/figma.js";
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse, Server } from "http";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SimplifiedDesign } from "./services/simplify-node-response.js";
import * as yaml from "js-yaml";
import * as https from "https";
import { findImageNodeIds } from "./utils/common.js";
import { fetchImageUrls } from "./services/figma.js";
import { analyzeImageWithOpenAIVision } from "./services/openai.js";

export const Logger = {
  log: (...args: any[]) => { },
  error: (...args: any[]) => { },
};

export class FigmaMcpServer {
  public readonly server: McpServer;
  private readonly figmaService: FigmaService;
  private transports: { [sessionId: string]: SSEServerTransport } = {};
  private httpServer: Server | null = null;

  constructor(figmaApiKey: string) {
    this.figmaService = new FigmaService(figmaApiKey);
    this.server = new McpServer(
      {
        name: "Figma MCP Server",
        version: "0.1.18",
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    this.registerTools();
  }

  private registerTools(): void {
    this.server.tool(
      "get_figma_data",
      "Fetch layout info from a Figma file",
      {
        fileKey: z.string(),
        nodeId: z.string().optional(),
        depth: z.number().optional(),
      },
      async ({ fileKey, nodeId, depth }: { fileKey: string, nodeId?: string, depth?: number }) => {
        try {
          let file: SimplifiedDesign;
          if (nodeId) {
            file = await this.figmaService.getNode(fileKey, nodeId, depth);
          } else {
            file = await this.figmaService.getFile(fileKey, depth);
          }
          const { nodes, globalVars, ...metadata } = file;
          const result = { metadata, nodes, globalVars };
          const yamlResult = yaml.dump(result);
          return { content: [{ type: "text", text: yamlResult }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: `Error fetching file: ${error}` }],
          };
        }
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    Logger.log = () => {};
    Logger.error = () => {};
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express();
    app.use(express.json());

    app.get("/sse", async (req: Request, res: Response) => {
      const transport = new SSEServerTransport(
        "/messages",
        res as unknown as ServerResponse<IncomingMessage>
      );
      this.transports[transport.sessionId] = transport;
      res.on("close", () => delete this.transports[transport.sessionId]);
      await this.server.connect(transport);
    });

    app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      if (!this.transports[sessionId]) {
        res.status(400).send(`No transport found for sessionId ${sessionId}`);
        return;
      }
      await this.transports[sessionId].handlePostMessage(req, res);
    });

    app.post("/context", async (req: Request, res: Response) => {
      try {
        const { figma_url, access_token, openai_api_key } = req.body;

        function extractFileKey(url: string): string | null {
          const match = url.match(/\/(?:file|design)\/([a-zA-Z0-9]+)/);
          return match ? match[1] : null;
        }

        function extractNodeId(url: string): string | null {
          const match = url.match(/node-id=([a-zA-Z0-9%:\-]+)/);
          if (!match) return null;
          return match[1].replace("-", ":");
        }

        const fileKey = extractFileKey(figma_url);
        const nodeId = extractNodeId(figma_url);

        if (!fileKey || !nodeId) {
          return res.status(400).json({ error: "Invalid Figma URL" });
        }

        const options = {
          hostname: 'api.figma.com',
          path: `/v1/files/${fileKey}/nodes?ids=${nodeId}`,
          method: 'GET',
          headers: {
            'X-Figma-Token': access_token  // ✅ 사용자로부터 받은 토큰 사용
          }
        };

        const figmaResponse: any = await new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
          });
          req.on('error', reject);
          req.end();
        });

        const node = figmaResponse.nodes?.[nodeId]?.document;
        if (!node) {
          return res.status(404).json({ error: "Node not found in Figma response" });
        }

        // 1. 이미지 포함 노드 ID 수집
        const imageNodeIds = findImageNodeIds(node);

        // 2. Figma API로 실제 image_url 가져오기
        const imageUrls = await fetchImageUrls(fileKey, imageNodeIds, access_token);

        function findText(n: any): string[] {
          if (n.type === "TEXT" && n.characters) return [n.characters];
          if (n.children) return n.children.flatMap(findText);
          return [];
        }

        const texts = findText(node);
        const targetText = texts.join("\n");
        const nodeInfo = { path: [node?.name || "이름 없음"] };
        const contextSummary = `이 노드는 ${node?.type} 타입이며 이름은 "${node?.name}"입니다.
` +
          `텍스트: ${targetText.substring(0, 40)}...
` +
          `버튼 위치: ${JSON.stringify(node?.absoluteBoundingBox || {})}
` +
          `색상: ${JSON.stringify(node?.fills || [])}
` +
          `스타일: ${JSON.stringify(node?.style || {})}`;

        function findFirstPosition(n: any): any {
          if (n.absoluteBoundingBox) return n.absoluteBoundingBox;
          if (n.children) {
            for (const child of n.children) {
              const found = findFirstPosition(child);
              if (found) return found;
            }
          }
          return null;
        }

        const resolvedPosition = node?.absoluteBoundingBox || findFirstPosition(node);
        const position = resolvedPosition || "❌ 위치 정보 없음";

        const explanation = `이 오브젝트는 '${node?.name}'라는 이름을 가진 ${node?.type} 타입입니다.
` +
          `위치는 ${resolvedPosition ? `x: ${resolvedPosition.x}, y: ${resolvedPosition.y}` : "확인되지 않음"}이며, ` +
          `배경 색상은 ${node?.fills?.[0]?.color ? JSON.stringify(node.fills[0].color) : "제공되지 않음"}입니다.
` +
          `텍스트는 '${targetText.substring(0, 30)}...'이며, 시각 강조 스타일은 ${node?.style ? JSON.stringify(node.style) : "없음"}입니다.`;

        // 3. 계층 구조 생성 (이미지 URL 및 Vision 분석 포함)
        const hierarchy = await buildHierarchy(node, imageUrls, openai_api_key);

        res.json({
          name: node?.name || "이름 없음",
          target_text: targetText,
          context_summary: contextSummary,
          node_info: nodeInfo,
          position: position,
          fills: node?.fills || [],
          strokes: node?.strokes || [],
          style: node?.style || {},
          effects: node?.effects || [],
          explanation: explanation,
          hierarchy: hierarchy
        });
      } catch (e: any) {
        console.error("❌ /context 오류:", e);
        res.status(500).json({ error: "Internal server error", detail: e?.message });
      }
    });

    this.httpServer = app.listen(port, () => {
      Logger.log(`HTTP server listening on port ${port}`);
    });
  }

  async stopHttpServer(): Promise<void> {
    if (!this.httpServer) throw new Error("HTTP server is not running");
    return new Promise((resolve, reject) => {
      this.httpServer!.close((err: Error | undefined) => {
        if (err) return reject(err);
        this.httpServer = null;
        Promise.all(
          Object.values(this.transports).map((transport) => transport.close())
        ).then(resolve);
      });
    });
  }
}

async function buildHierarchy(node: any, imageUrls: Record<string, string>, openaiApiKey: string): Promise<any> {
  const simplified: any = {
    name: node.name || "이름 없음",
    type: node.type,
    characters: node.characters || "",
    position: node.absoluteBoundingBox || null,
    fills: node.fills || [],
    strokes: node.strokes || [],
    style: node.style || {},
    effects: node.effects || [],
  };
  if (imageUrls[node.id]) {
    simplified.image_url = imageUrls[node.id];
    try {
      // Vision API 호출 및 결과 저장
      simplified.vision_text = await analyzeImageWithOpenAIVision(imageUrls[node.id], openaiApiKey);
    } catch (e) {
      // 에러 메시지도 계층구조에 포함
      simplified.vision_text = "이미지 분석 실패: " + (e instanceof Error ? e.message : String(e));
    }
  }
  if (node.children) {
    simplified["children"] = [];
    for (const child of node.children) {
      simplified["children"].push(await buildHierarchy(child, imageUrls, openaiApiKey));
    }
  }
  return simplified;
}
