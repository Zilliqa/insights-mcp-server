# Zilliqa Insights MCP Server

The Zilliqa Insights [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) Server is a component designed to provide LLM interaction with Zilliqa validator nodes observability metrics.

## Prerequisites

- [Node.js](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm):
  version 20 or higher

## Usage

You can ask your MCP client natural language questions about the Zilliqa validator nodes. Here are a few examples:

- **"What is the zil address for Huobi?"**
- **"What is the zil stake for Binance in October 2025?"**
- **"How reliable was Zillet at proposing blocks last week?."**
- **"What were the total ZIL rewards for Moonlet yesterday?"**

Your MCP client will translate these questions into the appropriate tool calls to fetch the data from the MCP server.

## Available Tools

This server exposes several tools that query validator performance and status metrics. These tools act as a proxy, connecting to the downstream `observability-mcp` server, which is part of the [`gcloud-mcp`](https://github.com/Zilliqa/gcloud-mcp), to retrieve data from Google Cloud Monitoring.

-   **`getTotalValidatorEarnings(validator, startTime?, endTime?)`**
    -   Retrieves the total ZIL rewards earned by a specific validator within a given time frame. Defaults to the last hour if no time is specified.

-   **`getValidatorEarningsBreakdown(validator, startTime?, endTime?)`**
    -   Provides a detailed breakdown of a validator's earnings, separating rewards from block proposals and cosignatures.

-   **`getValidatorStake(public_key)`**
    -   Fetches the total amount of ZIL currently delegated (staked) to a validator, which represents their weight in the consensus mechanism.

-   **`getProposerSuccessRate(public_key, startTime?, endTime?)`**
    -   Calculates the success rate for a validator when they are tasked with proposing a new block. This is a critical indicator of node stability and network latency.

-   **`getCosignerSuccessRate(public_key, startTime?, endTime?)`**
    -   Measures the validator's success rate for cosigning (attesting to) blocks proposed by others. This demonstrates consistent uptime and connectivity.

## Development

Follow these instructions to get the server running on your local machine for development and testing purposes.

### 1. Installation

First, install the project dependencies using npm:

```bash
npm install
```

### 2. Build

Next, compile the TypeScript source code into JavaScript:

```bash
npm run build
```

This will create a `build` directory containing the distributable files.

### 3. Running the Server

The server can operate in two modes:
- **`stdio` mode**: The server communicates over standard input/output. This is typically used for direct interaction with the MCP server on the same machine. This is the default option.
- **`http` mode**: The server exposes an HTTP API, allowing for remote communication and management from other services.

```bash
node build/index.js
```

To run the server in HTTP streamable mode add the `--http` flag:

```bash
node build/index.js --http
```

### 4. Configuring the LLM settings

Add this configuration in the LLM local settings to test the MCP server. This is an example for Gemini:

```json
"mcpServers": {
  "insights-local": {
    "httpUrl": "http://localhost:3001/mcp"
  }
}
```

## Deployment

### Kubernetes

The Kubernetes manifests for deploying this server are located in the `cd/` directory. Environment-specific configurations can be found in `cd/overlays/`.

### Production environment

A production version of this server is automatically deployed via GitHub Actions pipelines. The deployment is triggered on the creation of a new release and it is accessible at the following URL:

- **URL**: https://insights.mcp.zilliqa.com/mcp

### Configuring the LLM settings

Add this configuration in the LLM local settings to test the MCP server. This is an example for Gemini:

```json
"mcpServers": {
  "insights": {
    "httpUrl": "https://insights.mcp.zilliqa.com/mcp"
  }
}
```