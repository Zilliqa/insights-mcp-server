import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// --- Constants for Google Cloud Monitoring ---
const GCP_PROJECT_ID = "prj-p-devops-services-tvwmrf63";
const GCE_INSTANCE_ID = "7753770768243446498";
const METRIC_TYPE_EARNINGS = "workload.googleapis.com/validator_earned_reward";
const METRIC_TYPE_PROPOSALS = "prometheus.googleapis.com/zilliqa_proposed_views_total/counter";
const METRIC_TYPE_COSIGNATURES = "prometheus.googleapis.com/zilliqa_cosigned_views_total/counter";
const METRIC_TYPE_STAKE = "prometheus.googleapis.com/zilliqa_deposit_balance/gauge";

// --- Constants for Downstream MCP Client ---
const MCP_COMMAND = "node";
const MCP_ARGS = ["/home/psl/workspace/gcloud-mcp/packages/observability-mcp/dist/bundle.js"];

/**
 * Gets total validator earnings by acting as a client to another downstream MCP server.
 * This function constructs a direct tool call to the other service.
 * @param validator The address of the validator.
 * @param startTime The start of the time range in ISO 8601 format.
 * @param endTime The end of the time range in ISO 8601 format.
 * @returns A promise that resolves with the tool's response content from the downstream server.
 */
export async function getTotalValidatorEarnings(
  validator: string,
  startTime?: string,
  endTime?: string,
): Promise<{ content: ({ type: 'text', text: string })[] }> {    
    // Set up default time range: If endTime is not provided, use the current time.
    // If startTime is not provided, use 1 hour before the end time.
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    const timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    return withMcpClient(async (mcpClient) => {
        // This matches the expected input schema of the downstream 'list_time_series' tool.
        const toolArguments = {
            name: `projects/${GCP_PROJECT_ID}`,
            filter: `metric.type = "${METRIC_TYPE_EARNINGS}" AND metric.labels.address = "${validator}" AND resource.type = "gce_instance" AND resource.labels.instance_id = "${GCE_INSTANCE_ID}"`,
            interval: {
                startTime: queryStartTime,
                endTime: queryEndTime,
            },
            aggregation: {
                alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                perSeriesAligner: 'ALIGN_DELTA',
            },
        };

        // Directly invoke the 'list_time_series' tool on the downstream MCP server.
        const toolCallResult = await mcpClient.callTool({
            name: 'list_time_series',
            arguments: toolArguments,
        });

        const total_earnings_zil = parseTimeSeriesValue(toolCallResult.content);

        // Format the response as requested.
        const response = {
            status: "success",
            data: { 
                total_earnings_zil,
                message: `The total ZIL rewards for validator ${validator} were ${total_earnings_zil.toFixed(2)}${timeFrameText}.`
            }
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Provides a detailed breakdown of a validator's earnings, separating rewards from block proposals and cosignatures.
 * This function constructs direct tool calls to another downstream MCP server to get earnings for each reward type.
 * @param validator The address of the validator.
 * @param startTime The start of the time range in ISO 8601 format.
 * @param endTime The end of the time range in ISO 8601 format.
 * @returns A promise that resolves with the tool's response content, containing the earnings breakdown.
 */
export async function getValidatorEarningsBreakdown(
    validator: string,
    startTime?: string,
    endTime?: string,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    // Set up default time range: If endTime is not provided, use the current time.
    // If startTime is not provided, use 1 hour before the end time.
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    const timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();
    
    return withMcpClient(async (mcpClient) => {
        const getEarningsForType = async (role: 'proposer' | 'cosigner'): Promise<number> => {            
            const filter = `metric.type = "${METRIC_TYPE_EARNINGS}" AND metric.labels.address = "${validator}" AND resource.type = "gce_instance" AND resource.labels.instance_id = "${GCE_INSTANCE_ID}" AND metric.labels.role = "${role}"`;      
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter: filter,
                interval: {
                    startTime: queryStartTime,
                    endTime: queryEndTime,
                },
                aggregation: {
                    alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                    perSeriesAligner: 'ALIGN_DELTA',
                },
            };

            // Directly invoke the 'list_time_series' tool on the downstream MCP server.
            const toolCallResult = await mcpClient.callTool({
                name: 'list_time_series',
                arguments: toolArguments,
            });

            // Parse the time series data to extract the numeric value.
            return parseTimeSeriesValue(toolCallResult.content);
        };

        // Concurrently fetch earnings for both proposals and cosignatures
        const [proposal_earnings_zil, cosigning_earnings_zil] = await Promise.all([
            getEarningsForType('proposer'),
            getEarningsForType('cosigner')
        ]);

        // Format the response as requested.
        const response = {
            status: "success",
            data: {
                proposal_earnings_zil,
                cosigning_earnings_zil,
                message: `Earnings breakdown for validator ${validator}${timeFrameText}: Proposal Rewards: ${proposal_earnings_zil.toFixed(2)} ZIL, Cosigning Rewards: ${cosigning_earnings_zil.toFixed(2)} ZIL.`
            }
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Retrieves the total amount of ZIL currently delegated to a validator.
 * This represents their weight in the consensus mechanism.
 * @param validator The address of the validator.
 * @returns A promise that resolves with the tool's response content, containing the total stake.
 */
export async function getValidatorStake(
    public_key: string,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    // For "right now" queries, we look at a small, recent time window.
    const end = new Date();
    const start = new Date(end.getTime() - 5 * 60 * 1000); // 5 minutes ago
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    return withMcpClient(async (mcpClient) => {
        const toolArguments = {
            name: `projects/${GCP_PROJECT_ID}`,
            // This filter targets the specific stake metric for the given validator.
            filter: `metric.type = "${METRIC_TYPE_STAKE}" AND metric.labels.validator = "${public_key}"`,
            interval: {
                startTime: queryStartTime,
                endTime: queryEndTime,
            },
            // Note: Aggregation is not needed for GAUGE metrics like stake,
            // as we are just fetching the latest reported value.
        };

        // Directly invoke the 'list_time_series' tool on the downstream MCP server.
        const toolCallResult = await mcpClient.callTool({
            name: 'list_time_series',
            arguments: toolArguments,
        });

        const total_stake_zil = parseTimeSeriesLatestValue(toolCallResult.content);

        // Format the response as requested.
        const response = {
            status: "success",
            data: { total_stake_zil }
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Measures a validator's performance specifically when tasked with proposing a new block.
 * A 100% proposer success rate is the gold standard. A missed proposal means a delay
 * in the chain and lost rewards for that validator. This metric is a critical indicator
 * of a validator's node stability and network latency.
 * @param validator The address of the validator.
 * @param startTime The start of the time range in ISO 8601 format.
 * @param endTime The end of the time range in ISO 8601 format.
 * @returns A promise that resolves with the tool's response content, containing the proposer success rate.
 */
export async function getProposerSuccessRate(
    public_key: string,
    startTime?: string,
    endTime?: string,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    // Set up default time range: If endTime is not provided, use the current time.
    // If startTime is not provided, use 1 hour before the end time.
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    const timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    return withMcpClient(async (mcpClient) => {
        const getProposalCount = async (statusFilter: string): Promise<number> => {
            const filter = `metric.type = "${METRIC_TYPE_PROPOSALS}" AND metric.labels.validator = "${public_key}" ${statusFilter}`;
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter: filter,
                interval: {
                    startTime: queryStartTime,
                    endTime: queryEndTime,
                },
                aggregation: {
                    alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                    perSeriesAligner: 'ALIGN_DELTA',
                },
            };

            // Directly invoke the 'list_time_series' tool on the downstream MCP server.
            const toolCallResult = await mcpClient.callTool({
                name: 'list_time_series',
                arguments: toolArguments,
            });

            // Parse the time series data to extract the numeric value.
            return parseTimeSeriesValue(toolCallResult.content);
        };

        // Concurrently fetch total proposals, and the counts for each "successful" status.
        // We fetch 'proposed' and 'missed_next_missed' separately to avoid potential issues
        // with complex OR filters in the downstream API, then sum them.
        const [totalProposals, proposedCount, missedNextMissedCount] = await Promise.all([
            getProposalCount(''), // No status filter for total
            getProposalCount('AND metric.labels.status = "proposed"'),
            getProposalCount('AND metric.labels.status = "missed_next_missed"'),
        ]);

        const successfulProposals = proposedCount + missedNextMissedCount;

        let proposer_success_rate: string;
        if (totalProposals > 0) {
            const rate = (successfulProposals / totalProposals) * 100;
            proposer_success_rate = `${rate.toFixed(2)}%`;
        } else {
            proposer_success_rate = "N/A (0 proposals attempted)";
        }

        // Format the response as requested.
        const response = {
            status: "success",
            data: {
                proposer_success_rate,
                message: `Proposer success rate for validator ${public_key} was ${proposer_success_rate}${timeFrameText}.`
            }
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Measures a validator's performance when tasked with cosigning (attesting to) a block proposed by another validator.
 * Cosigning is the most frequent duty. A high success rate demonstrates consistent uptime and connectivity.
 * Even a small dip here can lead to a noticeable reduction in rewards over time.
 * @param validator The address of the validator.
 * @param startTime The start of the time range in ISO 8601 format.
 * @param endTime The end of the time range in ISO 8601 format.
 * @returns A promise that resolves with the tool's response content, containing the cosigner success rate.
 */
export async function getCosignerSuccessRate(
    public_key: string,
    startTime?: string,
    endTime?: string,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    // Set up default time range: If endTime is not provided, use the current time.
    // If startTime is not provided, use 1 hour before the end time.
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    const timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    return withMcpClient(async (mcpClient) => {
        const getCosignatureCount = async (cosignedFilter: string): Promise<number> => {
            const filter = `metric.type = "${METRIC_TYPE_COSIGNATURES}" AND metric.labels.validator = "${public_key}" ${cosignedFilter}`;
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter: filter,
                interval: {
                    startTime: queryStartTime,
                    endTime: queryEndTime,
                },
                aggregation: {
                    alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                    perSeriesAligner: 'ALIGN_DELTA',
                },
            };

            // Directly invoke the 'list_time_series' tool on the downstream MCP server.
            const toolCallResult = await mcpClient.callTool({
                name: 'list_time_series',
                arguments: toolArguments,
            });

            // Parse the time series data to extract the numeric value.
            return parseTimeSeriesValue(toolCallResult.content);
        };

        // Concurrently fetch total cosignatures and successful cosignatures
        const [totalCosignatures, successfulCosignatures] = await Promise.all([
            getCosignatureCount(''), // No filter for total
            getCosignatureCount('AND metric.labels.cosigned = "true"'), // Filter for successful
        ]);

        let cosigner_success_rate: string;
        if (totalCosignatures > 0) {
            const rate = (successfulCosignatures / totalCosignatures) * 100;
            cosigner_success_rate = `${rate.toFixed(2)}%`;
        } else {
            cosigner_success_rate = "N/A (0 cosignatures attempted)";
        }

        // Format the response as requested.
        const response = {
            status: "success",
            data: {
                cosigner_success_rate,
                message: `Cosigner success rate for validator ${public_key} was ${cosigner_success_rate}${timeFrameText}.`
            }
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Parses the content of a time series response to extract the doubleValue.
 * The response is expected to be a JSON string within a text content part.
 * @param content The `content` array from a toolCallResult.
 * @returns The extracted double value, or 0 if not found.
 */
function parseTimeSeriesValue(content: unknown): number {
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') {
        try {
            const timeSeriesData = JSON.parse(content[0].text);

            if (Array.isArray(timeSeriesData) && timeSeriesData.length > 0) {
                // Iterate over all time series in the response and sum their values.
                // This correctly handles both single-series responses (for breakdown)
                // and multi-series responses (for total).
                return timeSeriesData.reduce((total, timeSeries) => {
                    if (timeSeries?.points?.[0]?.value) {
                        const valueContainer = timeSeries.points[0].value;
                        if (typeof valueContainer.doubleValue === 'number') {
                            return total + valueContainer.doubleValue;
                        }
                        if (typeof valueContainer.int64Value !== 'undefined') {
                            return total + Number(valueContainer.int64Value);
                        }
                    }
                    return total;
                }, 0);
            }
        } catch (e) {
            console.error("Failed to parse time series data from sub-MCP:", e);
        }
    }
    return 0;
}

/**
 * Parses the content of a time series response to extract the doubleValue.
 * This specific parser is designed to handle cases where multiple time series
 * might be returned but only the latest value.
 * @param content The `content` array from a toolCallResult.
 * @returns The extracted double value, or 0 if not found.
 */

function parseTimeSeriesLatestValue(content: unknown): number {
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') {
        try {
            const timeSeriesData = JSON.parse(content[0].text);

            if (Array.isArray(timeSeriesData) && timeSeriesData.length > 0) {
                // The issue is that the query returns duplicate records.
                // Since they report the same value, we just need the value from the first record.
                const firstTimeSeries = timeSeriesData[0];
                
                // Ensure the first record has points
                if (firstTimeSeries?.points?.[0]?.value) {
                    const valueContainer = firstTimeSeries.points[0].value;
                    
                    // Prioritize doubleValue, then check for int64Value
                    if (typeof valueContainer.doubleValue === 'number') {
                        return valueContainer.doubleValue;
                    }
                    if (typeof valueContainer.int64Value !== 'undefined') {
                        return Number(valueContainer.int64Value);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse time series data from sub-MCP:", e);
        }
    }
    // Return 0 if data is not found or parsing fails
    return 0;
}

/**
 * A higher-order function that manages the lifecycle of an MCP client connection.
 * It handles client creation, connection, executing a provided action, and cleanup.
 * @param action A function that receives the connected MCP client and performs operations.
 * @returns A promise that resolves with the content to be returned by the tool.
 */
async function withMcpClient<T>(
    action: (client: Client) => Promise<T>
): Promise<{ content: any[] }> {
    const mcpClient = new Client({ name: "observability-mcp", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: MCP_COMMAND, args: MCP_ARGS });

    try {
        console.error("Connecting to sub-MCP server...");
        await mcpClient.connect(transport);
        
        const result = await action(mcpClient);

        console.error("Received response from sub-MCP server.");        
        // If the action returns an array, assume it's the complete 'content' array.
        // Otherwise, if it's a single content part object, wrap it in an array.
        const content = Array.isArray(result) ? result : [result];
        return { content };
    } catch (error) {
        console.error("ERROR during sub-MCP communication:", error);
        const errorResponse = {
            status: "failed",
            reason: `Error calling downstream MCP: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
        return { content: [{ type: "text", text: JSON.stringify(errorResponse) }] };
    } finally {
        if (mcpClient) {
            console.error("Closing connection to sub-MCP server.");
            await mcpClient.close();
        }
    }
}
