import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from './tools/registration.js';
import pkg from '../package.json' with { type: 'json' };
import express, { Request, Response } from "express";
import cors from "cors";
import logger from './utils/logger.js';
import { withRequestContext } from './utils/requestContext.js';

// HTTP Config
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// Create server instance
const getServer = (): McpServer => {
    const server = new McpServer({
        name: 'insights-mcp-server',
        version: pkg.version,
        title: 'Zilliqa Insights MCP',
        description: 'MCP Server for interacting with the Zilliqa validators metrics and APIs',
    });
    registerTools(server);
    return server;
};

// Start the server
async function main() {
    const isHttpMode = process.argv.includes('--http');
    const server = getServer();

    if (isHttpMode) {
        // HTTP Streamable Transport Mode
        logger.info(`Starting EVM MCP Server on ${HOST}:${PORT} with Streamable HTTP transport`);

        // Setup Express
        const app = express();
        app.set('trust proxy', true); // Enable trust proxy for correct client IP
        app.use(express.json());
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true,
            exposedHeaders: ['Content-Type', 'Access-Control-Allow-Origin']
        }));

        // Add OPTIONS handling for preflight requests
        app.options(/\/.*/, cors());

        // Health check endpoint
        app.get("/health", (req: Request, res: Response) => {
            res.json({
                status: "ok",
                server: "initialized"
            });
        });

        // Endpoint for StreamableHTTP connection (GET)
        app.get('/mcp', (req: Request, res: Response) => {
            // Get real client IP (supports proxies/load balancers)
            const realIp = req.headers['x-forwarded-for']?.toString().split(',')[1]?.trim() || req.ip;
            logger.debug(`Received GET connection request from ${realIp}`);

            // Server MUST either return 'text/event-stream' or 405 Method Not Allowed.
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            });

            res.end();
        });

        // Main MCP endpoint - stateless mode (POST)
        app.post('/mcp', async (req: Request, res: Response) => {
            const realIp = req.headers['x-forwarded-for']?.toString().split(',')[1]?.trim() || req.ip;
            logger.debug(`Received POST MCP request from ${realIp}`);
            
            try {
                await withRequestContext({ ip: realIp }, async () => {
                    // Create a new transport for each request (stateless mode)
                    const transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: undefined, // Stateless mode
                        enableJsonResponse: false,
                    });

                    // Handle request close
                    res.on('close', () => {
                        transport.close();
                    });

                    // Connect transport to server
                    await server.connect(transport);

                    // Handle the request
                    await transport.handleRequest(req, res, req.body);
                });
                
            } catch (error) {
                logger.error(error as unknown as object, 'Error handling MCP request');
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                            data: error instanceof Error ? error.message : String(error)
                        },
                        id: (req.body as any)?.id || null,
                    });
                }
            }
        });

        // Start the HTTP server
        const httpServer = app.listen(Number(PORT), HOST, (error) => {
            if (error) {
                logger.error(error as unknown as object, 'Failed to start server');
                process.exit(1);
            }
            logger.info(`EVM MCP Server listening on port ${PORT}`);
            logger.info(`Endpoint: http://${HOST}:${PORT}/mcp`);
            logger.info(`Health: http://${HOST}:${PORT}/health`);
        });

        // Handle graceful shutdown
        const shutdown = () => {
            server.close();
            httpServer.close(() => {
                logger.info('HTTP server closed');
                process.exit(0);
            });
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);


    } else {
        // Default Stdio Transport Mode
        const transport = new StdioServerTransport();
        await server.connect(transport);
        logger.info("MCP Server running on stdio");
        
        // Handle graceful shutdown for stdio mode
        process.on('SIGINT', () => {
            server.close();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            server.close();
            process.exit(0);
        });
    }
}

main().catch((error) => {
    logger.error(error as unknown as object, "Fatal error in main()");
    process.exit(1);
});