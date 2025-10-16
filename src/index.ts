import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from './tools/registration.js';
import pkg from '../package.json' with { type: 'json' };

// --- HTTP Streamable Imports and Configuration (Minimal Changes) ---
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import cors from "cors";

// HTTP Config
const PORT = 3001;
const HOST = '0.0.0.0';
// ------------------------------------------------------------------

// Create server instance
const getServer = (): McpServer => {
    const server = new McpServer({
        name: 'validator-mcp',
        version: pkg.version,
        title: 'Zilliqa Validator MCP',
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

        // Setup Express
        const app = express();
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
                server: "initialized" // Assume initialized since it's running
            });
        });

        // Endpoint for StreamableHTTP connection (GET)
        // @ts-ignore
        app.get('/mcp', (req: Request, res: Response) => {
            console.error(`Received GET connection request from ${req.ip}`);
            
            // Server MUST either return 'text/event-stream' or 405 Method Not Allowed.
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            });
            
            // Handle client disconnect
            req.on('close', () => {
                console.error('Connection closed on GET /mcp');
            });
            
            // The StreamableHTTPServerTransport isn't designed to handle 
            // the bare GET stream for server-initiated messages in a stateless way
            // and this basic implementation doesn't use session management.
            // For a complete implementation, a stateful transport would be required 
            // to connect the bare GET stream to the server. 
            // For minimal implementation, we simply keep it open as a placeholder 
            // for the client to open an SSE stream.
            // This basic server assumes that all operations happen via POST.
        });

        // Main MCP endpoint - stateless mode (POST)
        // @ts-ignore
        app.post('/mcp', async (req: Request, res: Response) => {
            console.error(`Received POST MCP request from ${req.ip}`);
            
            try {
                // Create a new transport for each request (stateless mode)
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined, // Stateless mode
                    enableJsonResponse: false, // Use default behavior (SSE or JSON based on request)
                });
                
                // Handle request close
                res.on('close', () => {
                    console.error('Request closed');
                    transport.close();
                });
                
                // Connect transport to server
                await server.connect(transport);
                
                // Handle the request
                await transport.handleRequest(req, res, req.body);
                
            } catch (error) {
                console.error('Error handling MCP request:', error);
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
        const httpServer = app.listen(PORT, HOST, (error) => {
            if (error) {
                console.error('Failed to start server:', error);
                process.exit(1);
            }
            console.error(`EVM MCP Server listening on port ${PORT}`);
            console.error(`Endpoint: http://${HOST}:${PORT}/mcp`);
            console.error(`Health: http://${HOST}:${PORT}/health`);
        });

        // Handle graceful shutdown
        const shutdown = () => {
            console.error('\nReceived signal, shutting down gracefully...');
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