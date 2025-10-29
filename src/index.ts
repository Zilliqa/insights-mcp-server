// Map to store keep-alive intervals for each transport
const transportKeepAliveMap = new WeakMap<StreamableHTTPServerTransport, NodeJS.Timeout>();
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerTools } from './tools/registration.js';
import pkg from '../package.json' with { type: 'json' };
import express, { Request, Response } from "express";
// Removed fetch-to-node adapter import; not available in SDK
import cors from "cors";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// HTTP Config
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
// ------------------------------------------------------------------

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
        console.error(`Starting EVM MCP Server on ${HOST}:${PORT} with Streamable HTTP transport`);
        const transports: Record<string, StreamableHTTPServerTransport> = {};

        // Setup Express
        const app = express();
        app.use(express.json());
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
            credentials: true,
            exposedHeaders: ['Content-Type', 'Access-Control-Allow-Origin', 'mcp-session-id']
        }));

        // Add OPTIONS handling for preflight requests
        app.options(/\/.*/, cors());

        // Health check endpoint
        app.get("/health", (req: Request, res: Response) => {
            res.json({
                status: "ok",
                server: "initialized",
                active_sessions: Object.keys(transports).length
            });
        });
   
        app.post('/mcp', async (req: Request, res: Response) => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            let transport: StreamableHTTPServerTransport | undefined;

            console.error(`[POST] Incoming request: sessionId=${sessionId}`);
            console.error(`[POST] Headers:`, req.headers);
            console.error(`[POST] Body:`, req.body);

            if (sessionId && transports[sessionId]) {
                // Session exists, reuse transport
                console.error(`[${sessionId}] Reusing transport for POST`);
                transport = transports[sessionId];
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // This is a new session
                console.error(`[NEW] Received initialize request`);
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: false,
                    onsessioninitialized: (newSessionId) => {
                        console.error(`[${newSessionId}] Session initialized, storing transport.`);
                        transports[newSessionId] = transport!;
                        // Send a keepalive notification event immediately
                        try {
                            if (transport?.send) {
                                const event = {
                                    jsonrpc: "2.0" as const,
                                    method: "notifications/keepalive",
                                    params: { message: "Session initialized, keepalive event" }
                                };
                                transport.send(event);
                                console.error(`[${newSessionId}] Sent immediate keepalive notification event:`, event);
                            }
                        } catch (e) {
                            console.error(`[${newSessionId}] Error sending immediate keepalive event:`, e);
                        }
                        // Start keep-alive notification every 10 seconds
                        const keepAlive = setInterval(() => {
                            try {
                                if (transport?.send) {
                                    const event = {
                                        jsonrpc: "2.0" as const,
                                        method: "notifications/keepalive",
                                        params: { message: "Periodic keepalive event" }
                                    };
                                    transport.send(event);
                                    console.error(`[${newSessionId}] Sending keep-alive notification event:`, event);
                                }
                            } catch (e) {
                                console.error(`[${newSessionId}] Failed to send keep-alive notification, cleaning up interval.`, e);
                                clearInterval(keepAlive);
                            }
                        }, 10000);
                        transportKeepAliveMap.set(transport!, keepAlive);
                    },
                });

                transport.onclose = () => {
                    // Clear keep-alive interval if set
                    const keepAlive = transportKeepAliveMap.get(transport!);
                    if (keepAlive) {
                        console.error(`[${transport!.sessionId}] Clearing keep-alive interval on close.`);
                        clearInterval(keepAlive);
                        transportKeepAliveMap.delete(transport!);
                    }
                    if (transport!.sessionId) {
                        console.error(`[${transport!.sessionId}] Transport closed, cleaning up.`);
                        delete transports[transport!.sessionId];
                    }
                };
                transport.onerror = (err) => {
                    console.error(`[${transport?.sessionId || 'UNKNOWN'}] Transport error:`, err);
                };
                await server.connect(transport);

            } else {
                // Invalid request
                console.error(`[INVALID] Bad Request: No valid session ID or init request.`);
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided or not an initialize request",
                    },
                    id: (req.body as any)?.id || null,
                });
                console.error(`[POST] Sent 400 Bad Request response.`);
                return;
            }

            try {
                console.error(`[${transport.sessionId || 'UNKNOWN'}] Handling POST request with transport.`);
                await transport.handleRequest(req, res, req.body);
                console.error(`[${transport.sessionId || 'UNKNOWN'}] POST request handled, response sent.`);
            } catch (error) {
                console.error(`[${transport.sessionId || 'UNKNOWN'}] Error handling POST request:`, error);
                if (!res.headersSent) {
                    res.status(500).send("MCP POST error: " + error);
                    console.error(`[${transport.sessionId || 'UNKNOWN'}] Sent 500 error response.`);
                }
            }
        });

        // Helper to handle SSE and log reconnection advice
        function handleGetOrDelete(req: Request, res: Response) {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;

            console.error(`[${req.method}] Incoming request: sessionId=${sessionId}`);
            console.error(`[${req.method}] Headers:`, req.headers);

            if (!sessionId || !transports[sessionId]) {
                console.error(`[INVALID] Invalid or missing session ID for ${req.method} request.`);
                res.status(400).send("Invalid or missing session ID");
                console.error(`[${req.method}] Sent 400 Bad Request response.`);
                return;
            }
            console.error(`[${sessionId}] Reusing transport for ${req.method} (SSE)`);
            const transport = transports[sessionId];

            // Add response event logging for SSE diagnostics and reconnection advice
            res.on('close', () => {
                console.error(`[${sessionId}] Response closed (SSE stream ended).`);
                console.error(`[${sessionId}] Advise: Client should reconnect SSE stream now.`);
            });
            res.on('finish', () => {
                console.error(`[${sessionId}] Response finished (SSE stream finished).`);
            });

            (async () => {
                try {
                    console.error(`[${sessionId}] Handling ${req.method} request with transport.`);
                    await transport.handleRequest(req, res);
                    console.error(`[${sessionId}] ${req.method} request handled, response sent.`);
                } catch (error) {
                    console.error(`[${sessionId}] Error handling ${req.method} request:`, error);
                    if (!res.headersSent) {
                        res.status(500).send("SSE stream error: " + error);
                        console.error(`[${sessionId}] Sent 500 error response.`);
                    }
                }
            })();
        }

        app.get("/mcp", handleGetOrDelete);
        app.delete("/mcp", handleGetOrDelete);

        const httpServer = app.listen(Number(PORT), HOST, (error?: any) => {
            if (error) {
                console.error('Failed to start server:', error);
                process.exit(1);
            }
            console.error(`Insights MCP Server listening on port ${PORT}`);
            console.error(`Endpoint: http://${HOST}:${PORT}/mcp`);
            console.error(`Health: http://${HOST}:${PORT}/health`);
        });

        // Handle graceful shutdown
        const shutdown = () => {
            console.error('\nReceived signal, shutting down gracefully...');
            console.error(`Closing ${Object.keys(transports).length} active transports...`);
            for (const sessionId in transports) {
                try {
                    transports[sessionId].close();
                } catch (e) {
                    console.error(`Error closing transport ${sessionId}:`, e);
                }
            }

            server.close();
            httpServer.close(() => {
                console.error('HTTP server closed');
                process.exit(0);
            });
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);


    } else {
        // Default Stdio Transport Mode
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MCP Server running on stdio");
        
        // Handle graceful shutdown for stdio mode
        process.on('SIGINT', () => {
            console.error('\nReceived SIGINT, shutting down gracefully...');
            server.close();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.error('\nReceived SIGTERM, shutting down gracefully...');
            server.close();
            process.exit(0);
        });
    }
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});