import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FigmaService } from "./services/figma.js";
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse, Server } from "http";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SimplifiedDesign } from "./services/simplify-node-response.js";
import yaml from "js-yaml";
import cors from "cors";

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
    // Tool to get file information
    this.server.tool(
      "get_figma_data",
      "When the nodeId cannot be obtained, obtain the layout information about the entire Figma file",
      {
        fileKey: z
          .string()
          .describe(
            "The key of the Figma file to fetch, often found in a provided URL like figma.com/(file|design)/<fileKey>/...",
          ),
        nodeId: z
          .string()
          .optional()
          .describe(
            "The ID of the node to fetch, often found as URL parameter node-id=<nodeId>, always use if provided",
          ),
        depth: z
          .number()
          .optional()
          .describe(
            "How many levels deep to traverse the node tree, only use if explicitly requested by the user",
          ),
      },
      async ({ fileKey, nodeId, depth }) => {
        try {
          Logger.log(
            `Fetching ${depth ? `${depth} layers deep` : "all layers"
            } of ${nodeId ? `node ${nodeId} from file` : `full file`} ${fileKey}`,
          );

          let file: SimplifiedDesign;
          if (nodeId) {
            file = await this.figmaService.getNode(fileKey, nodeId, depth);
          } else {
            file = await this.figmaService.getFile(fileKey, depth);
          }

          Logger.log(`Successfully fetched file: ${file.name}`);
          const { nodes, globalVars, ...metadata } = file;

          const result = {
            metadata,
            nodes,
            globalVars,
          };

          Logger.log("Generating YAML result from file");
          const yamlResult = yaml.dump(result);

          Logger.log("Sending result to client");
          return {
            content: [{ type: "text", text: yamlResult }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : JSON.stringify(error);
          Logger.error(`Error fetching file ${fileKey}:`, message);
          return {
            isError: true,
            content: [{ type: "text", text: `Error fetching file: ${message}` }],
          };
        }
      },
    );

    // TODO: Clean up all image download related code, particularly getImages in Figma service
    // Tool to download images
    this.server.tool(
      "download_figma_images",
      "Download SVG and PNG images used in a Figma file based on the IDs of image or icon nodes",
      {
        fileKey: z.string().describe("The key of the Figma file containing the node"),
        nodes: z
          .object({
            nodeId: z
              .string()
              .describe("The ID of the Figma image node to fetch, formatted as 1234:5678"),
            imageRef: z
              .string()
              .optional()
              .describe(
                "If a node has an imageRef fill, you must include this variable. Leave blank when downloading Vector SVG images.",
              ),
            fileName: z.string().describe("The local name for saving the fetched file"),
          })
          .array()
          .describe("The nodes to fetch as images"),
        localPath: z
          .string()
          .describe(
            "The absolute path to the directory where images are stored in the project. If the directory does not exist, it will be created. The format of this path should respect the directory format of the operating system you are running on. Don't use any special character escaping in the path name either.",
          ),
      },
      async ({ fileKey, nodes, localPath }) => {
        try {
          const imageFills = nodes.filter(({ imageRef }) => !!imageRef) as {
            nodeId: string;
            imageRef: string;
            fileName: string;
          }[];
          const fillDownloads = this.figmaService.getImageFills(fileKey, imageFills, localPath);
          const renderRequests = nodes
            .filter(({ imageRef }) => !imageRef)
            .map(({ nodeId, fileName }) => ({
              nodeId,
              fileName,
              fileType: fileName.endsWith(".svg") ? ("svg" as const) : ("png" as const),
            }));

          const renderDownloads = this.figmaService.getImages(fileKey, renderRequests, localPath);

          const downloads = await Promise.all([fillDownloads, renderDownloads]).then(([f, r]) => [
            ...f,
            ...r,
          ]);

          // If any download fails, return false
          const saveSuccess = !downloads.find((success) => !success);
          return {
            content: [
              {
                type: "text",
                text: saveSuccess
                  ? `Success, ${downloads.length} images downloaded: ${downloads.join(", ")}`
                  : "Failed",
              },
            ],
          };
        } catch (error) {
          Logger.error(`Error downloading images from file ${fileKey}:`, error);
          return {
            isError: true,
            content: [{ type: "text", text: `Error downloading images: ${error}` }],
          };
        }
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);

    Logger.log = (...args: any[]) => {
      // this.server.server.sendLoggingMessage({
      //   level: "info",
      //   data: args,
      // });
      console.error("[INFO]", ...args);
    };
    Logger.error = (...args: any[]) => {
      // this.server.server.sendLoggingMessage({
      //   level: "error",
      //   data: args,
      // });
      console.error("[ERROR]", ...args);
    };

    // Ensure stdout is only used for JSON messages
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
      // Only allow JSON messages to pass through
      if (typeof chunk === "string" && !chunk.startsWith("{")) {
        return true; // Silently skip non-JSON messages
      }
      return originalStdoutWrite(chunk, encoding, callback);
    };

    Logger.log("Server connected and ready to process requests");
  }

async startHttpServer(port: number): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/sse", async (req: Request, res: Response) => {
    console.log("Establishing new SSE connection");
    const transport = new SSEServerTransport(
      "/messages",
      res as unknown as ServerResponse<IncomingMessage>,
    );
    console.log(`New SSE connection established for sessionId ${transport.sessionId}`);

    this.transports[transport.sessionId] = transport;
    res.on("close", () => {
      delete this.transports[transport.sessionId];
    });

    await this.server.connect(transport);
  });

  app.post("/evaluate", async (req: Request, res: Response) => {
    const { fileKey, nodeId, label } = req.body;

    try {
      const node = await this.figmaService.getNode(fileKey, nodeId);
      const contextText = JSON.stringify(node, null, 2);

      const prompt = `
[Figma 문맥]
${contextText}

[텍스트]
"${label}"

UX Writing 관점에서 이 텍스트는 적절한가요?
역할(버튼/헤더 등)에 맞는 표현인지, 개선점이 있다면 제안해주세요.
`;

      const result = await callOpenAI(prompt);
      res.json({ reply: result });
    } catch (err) {
      res.status(500).json({ error: "MCP 서버 GPT 처리 중 오류", detail: err });
    }
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!this.transports[sessionId]) {
      res.status(400).send(`No transport found for sessionId ${sessionId}`);
      return;
    }
    console.log(`Received message for sessionId ${sessionId}`);
    await this.transports[sessionId].handlePostMessage(req, res);
  });

  Logger.log = console.log;
  Logger.error = console.error;

  // ✅ listen은 단 한 번만!
  this.httpServer = app.listen(port, () => {
    Logger.log(`✅ HTTP server listening on port ${port}`);
    Logger.log(`SSE endpoint available at http://localhost:${port}/sse`);
    Logger.log(`Message endpoint available at http://localhost:${port}/messages`);
  });
}
}
