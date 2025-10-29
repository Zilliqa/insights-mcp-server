import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// @ts-ignore (Assuming this is a local file)
import { registerTools } from './tools/registration.js';
// @ts-ignore (Assuming this is a local file)
import pkg from '../package.json' with { type: 'json' };

// --- HTTP Streamable Imports and Configuration ---
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import cors from "cors";

// --- ADDED: Imports for session management ---
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// HTTP Config
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
// ------------------------------------------------------------------

// Create server instance
// This is correct: we create ONE server and connect multiple transports to it.
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
        console.error(`Starting EVM MCP Server on ${HOST}:${PORT} with Streamable HTTP transport`);

        // --- ADDED: Map to store transports by session ID ---
        const transports: Record<string, StreamableHTTPServerTransport> = {};

        // Setup Express
        const app = express();
        app.use(express.json());
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS', 'DELETE'], // Added DELETE
            // --- FIXED: Allow and Expose mcp-session-id ---
            allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
            credentials: true,
            exposedHeaders: ['Content-Type', 'Access-Control-Allow-Origin', 'mcp-session-id']
        }));

        // Add OPTIONS handling for preflight requests
        app.options(/\/.*/, cors());

        // --- REMOVED: Old single-transport logic ---
        // We no longer create one transport here.


        // Health check endpoint
        app.get("/health", (req: Request, res: Response) => {
            res.json({
                status: "ok",
                server: "initialized",
                active_sessions: Object.keys(transports).length
            });
        });

        
        // --- REMOVED: Old app.all('/mcp', ...) handler ---


        // --- ADDED: POST handler for client-to-server messages ---
        // @ts-ignore
        app.post('/mcp', async (req: Request, res: Response) => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            let transport: StreamableHTTPServerTransport | undefined;

            if (sessionId && transports[sessionId]) {
                // Session exists, reuse transport
                console.error(`[${sessionId}] Reusing transport for POST`);
                transport = transports[sessionId];
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // This is a new session
                console.error(`[NEW] Received initialize request`);
                
                // Create a NEW transport
                transport = new StreamableHTTPServerTransport({
                    // --- FIXED: This is required by the type ---
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: false,
                    onsessioninitialized: (newSessionId) => {
                        // Store the transport by session ID
                        console.error(`[${newSessionId}] Session initialized, storing transport.`);
                        transports[newSessionId] = transport!;
                    },
                });

                // Clean up transport when it closes
                transport.onclose = () => {
                    if (transport!.sessionId) {
                        console.error(`[${transport!.sessionId}] Transport closed, cleaning up.`);
                        delete transports[transport!.sessionId];
                    }
                };

                // Connect the main server to this new transport
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
                return;
            }

            // Handle the request (either new or existing)
            try {
                await transport.handleRequest(req, res, req.body);
            } catch (error) {
                console.error(`[${transport.sessionId || 'UNKNOWN'}] Error handling POST request:`, error);
                // Handle or log error
            }
        });

        // --- ADDED: GET handler for server-to-client (SSE) streams ---
        // @ts-ignore
        const handleGetOrDelete = async (req: Request, res: Response) => {
            const sessionId = req.headers["mcp-session-id"] as string | undefined;

            if (!sessionId || !transports[sessionId]) {
                console.error(`[INVALID] Invalid or missing session ID for ${req.method} request.`);
                res.status(400).send("Invalid or missing session ID");
                return;
            }

            console.error(`[${sessionId}] Reusing transport for ${req.method} (SSE)`);
            const transport = transports[sessionId];
            
            try {
                await transport.handleRequest(req, res);
            } catch (error) {
                console.error(`[${sessionId}] Error handling ${req.method} request:`, error);
            }
        };

        app.get("/mcp", handleGetOrDelete);
        app.delete("/mcp", handleGetOrDelete);


        // Start the HTTP server
        const httpServer = app.listen(Number(PORT), HOST, (error?: any) => { // Added type for error
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
            
            // --- FIXED: Close all active transports ---
            console.error(`Closing ${Object.keys(transports).length} active transports...`);
            for (const sessionId in transports) {
                try {
                    transports[sessionId].close();
                } catch (e) {
                    console.error(`Error closing transport ${sessionId}:`, e);
                }
            }

            server.close(); // Close the main server
            
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