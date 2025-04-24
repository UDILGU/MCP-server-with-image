import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaService } from "./services/figma.js";
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse, Server } from "http";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SimplifiedDesign } from "./services/simplify-node-response.js";
import yaml from "js-yaml";
import https from "https";

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
      async ({ fileKey, nodeId, depth }) => {
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
    Logger.log = console.log;
    Logger.error = console.error;
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
        const { figma_url, access_token } = req.body;

        function extractFileKey(url: string): string | null {
          const match = url.match(/\/(?:file|design)\/([a-zA-Z0-9]+)/);
          return match ? match[1] : null;
        }

        function extractNodeId(url: string): string | null {
          const match = url.match(/node-id=([a-zA-Z0-9%:\-]+)/);
          return match ? match[1] : null;
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
          headers: { 'X-Figma-Token': access_token }
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
console.log("🧩 Figma Node 원본:", JSON.stringify(node, null, 2));
if (!node) {
  return res.status(404).json({ error: "Node not found in Figma response" });
}

        function findText(n: any): string[] {
          if (n.type === "TEXT" && n.characters) return [n.characters];
          if (n.children) return n.children.flatMap(findText);
          return [];
        }

        const texts = findText(node);
        const targetText = texts.join("\n");
        const nodeInfo = { path: [node?.name || "이름 없음"] };
        const contextSummary = `이 노드는 ${node?.type} 타입이며 이름은 \"${node?.name}\"입니다. 자식 텍스트 노드 수: ${texts.length}`;

        res.json({
          target_text: targetText,
          context_summary: contextSummary,
          node_info: nodeInfo,
        });
      } catch (e) {
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
