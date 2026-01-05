import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import logger from '../../utils/logger.js';

// --- Constants for Google Cloud Monitoring ---
const GCP_PROJECT_ID = "prj-p-devops-services-tvwmrf63";
const GCE_INSTANCE_ID = "7753770768243446498";
const METRIC_TYPE_EARNINGS = "workload.googleapis.com/validator_earned_reward";
const METRIC_TYPE_PROPOSALS = "prometheus.googleapis.com/zilliqa_proposed_views_total/counter";
const METRIC_TYPE_COSIGNATURES = "prometheus.googleapis.com/zilliqa_cosigned_views_total/counter";
const METRIC_TYPE_STAKE = "prometheus.googleapis.com/zilliqa_deposit_balance/gauge";
const METRIC_TYPE_VALIDATORS = "custom.googleapis.com/zilliqa/validators";

/**
 * Fetches the list of all validators from the downstream observability MCP server.
 * It queries a custom metric in Google Cloud Monitoring that holds validator metadata.
 * @returns A promise that resolves to an array of validator data objects.
 */
export async function getValidators(): Promise<{ name: string; public_key: string; address: string; zil_address: string; }[]> {
    // We call withMcpClient and then unpack the result to match the function's return signature.
    const result = await withMcpClient(async (mcpClient) => {
        // We query for the last known value of the validator metric over a wide time range.
        const end = new Date();
        const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

        const toolArguments = {
            name: `projects/${GCP_PROJECT_ID}`,
            // This filter targets the custom metric holding validator information.
            filter: `metric.type = "${METRIC_TYPE_VALIDATORS}" AND resource.type = "global"`,
            interval: {
                startTime: start.toISOString(),
                endTime: end.toISOString(),
            },
            // We only need the latest point for each validator series.
            aggregation: {
                alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                perSeriesAligner: 'ALIGN_MEAN',
            },
        };

        const toolCallResult = await mcpClient.callTool({
            name: 'list_time_series',
            arguments: toolArguments,
        });

        if (Array.isArray(toolCallResult.content) && toolCallResult.content.length > 0 && typeof toolCallResult.content[0].text === 'string') {
            try {
                const timeSeriesData = JSON.parse(toolCallResult.content[0].text);
                // The validator info is stored in the metric labels. We map over the time series to extract it.
                return { type: 'json', data: timeSeriesData.map((ts: any) => ts.metric.labels) };
            } catch (e) {
                logger.error(e as unknown as object, "Failed to parse validator list from sub-MCP");
            }
        }

        return []; // Return empty array on failure
    });

    // The result from withMcpClient is { content: [ { type: 'json', data: [ ...validators ] } ] }
    // We need to extract the data array.
    if (Array.isArray(result.content) && result.content.length > 0 && result.content[0].type === 'json' && Array.isArray(result.content[0].data)) {
        return result.content[0].data;
    }
    return []; // Return empty array if the structure is not as expected or on error.
}

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
            logger.error(e as unknown as object, "Failed to parse time series data from sub-MCP");
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
            logger.error(e as unknown as object, "Failed to parse time series data from sub-MCP");
        }
    }
    // Return 0 if data is not found or parsing fails
    return 0;
}

/**
 * Parses time series content and returns sums grouped by a metric label.
 * Useful for aggregating totals per validator address over a time range.
 * @param content The `content` array from a toolCallResult.
 * @param labelKey The label key to group by (e.g., 'address').
 * @returns A record mapping label value to the summed numeric value.
 */
function parseTimeSeriesGroupSum(
    content: unknown,
    labelKey: string
): Record<string, number> {
    const totals: Record<string, number> = {};
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') {
        try {
            const timeSeriesData = JSON.parse(content[0].text);
            if (Array.isArray(timeSeriesData) && timeSeriesData.length > 0) {
                for (const ts of timeSeriesData) {
                    const labels = ts?.metric?.labels || {};
                    const groupValue: string | undefined = labels[labelKey];
                    if (!groupValue) {
                        continue;
                    }
                    let value = 0;
                    if (ts?.points?.[0]?.value) {
                        const vc = ts.points[0].value;
                        if (typeof vc.doubleValue === 'number') {
                            value = vc.doubleValue;
                        } else if (typeof vc.int64Value !== 'undefined') {
                            value = Number(vc.int64Value);
                        }
                    }
                    totals[groupValue] = (totals[groupValue] || 0) + value;
                }
            }
        } catch (e) {
            logger.error(e as unknown as object, "Failed to parse grouped time series data from sub-MCP");
        }
    }
    return totals;
}

/**
 * Parses time series content and returns the latest value per group label.
 * Designed for GAUGE metrics (e.g., stake) to avoid summing duplicates.
 * @param content The `content` array from a toolCallResult.
 * @param labelKey The label key to group by (e.g., 'validator').
 * @returns A record mapping label value to the latest numeric value.
 */
function parseTimeSeriesGroupLatest(
    content: unknown,
    labelKey: string
): Record<string, number> {
    const latest: Record<string, number> = {};
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') {
        try {
            const timeSeriesData = JSON.parse(content[0].text);
            if (Array.isArray(timeSeriesData) && timeSeriesData.length > 0) {
                for (const ts of timeSeriesData) {
                    const labels = ts?.metric?.labels || {};
                    const groupValue: string | undefined = labels[labelKey];
                    if (!groupValue) continue;
                    if (latest[groupValue] !== undefined) continue; // first record wins
                    const points = Array.isArray(ts?.points) ? ts.points : [];
                    const firstPoint = points.length > 0 ? points[0] : undefined; // Cloud Monitoring usually orders latest first
                    if (firstPoint?.value) {
                        const vc = firstPoint.value;
                        if (typeof vc.doubleValue === 'number') {
                            latest[groupValue] = vc.doubleValue;
                        } else if (typeof vc.int64Value !== 'undefined') {
                            latest[groupValue] = Number(vc.int64Value);
                        }
                    }
                }
            }
        } catch (e) {
            logger.error(e as unknown as object, "Failed to parse grouped-latest time series data from sub-MCP");
        }
    }
    return latest;
}

/**
 * Retrieves the top validators by current stake within a time frame.
 * Aggregates GAUGE values across all validators and returns the top N.
 */
export async function getTopValidatorsByStake(
    startTime?: string,
    endTime?: string,
    limit: number = 5,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000); // default last 1 hour
    let timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    // Fetch validator metadata keyed by public_key for enrichment
    const validatorMeta = await getValidators();
    const byPubKey: Record<string, { name?: string; zil_address?: string; address?: string } > = {};
    for (const v of validatorMeta) {
        byPubKey[v.public_key] = { name: v.name, zil_address: v.zil_address, address: v.address };
    }

    return withMcpClient(async (mcpClient) => {
        const queryStake = async (fromIso: string, toIso: string) => {
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter: `metric.type = \"${METRIC_TYPE_STAKE}\" AND metric.labels.validator != \"\"`,
                interval: {
                    startTime: fromIso,
                    endTime: toIso,
                },
            };
            const toolCallResult = await mcpClient.callTool({
                name: 'list_time_series',
                arguments: toolArguments,
            });
            return parseTimeSeriesGroupLatest(toolCallResult.content, 'validator');
        };

        let latestByValidator = await queryStake(queryStartTime, queryEndTime);

        // If fewer than requested and no explicit timeframe provided, widen to 24h to include more validators.
        if ((!startTime && !endTime) && Object.keys(latestByValidator).length < limit) {
            const expandedStart = new Date(end.getTime() - 24 * 60 * 60 * 1000);
            const expandedStartIso = expandedStart.toISOString();
            const widened = await queryStake(expandedStartIso, queryEndTime);
            // Merge, preferring the 1h latest where present
            latestByValidator = { ...widened, ...latestByValidator };
            timeFrameText = " in the last 24 hours";
        }

        // Deep fallback: if still fewer than requested, fetch stakes per validator public key.
        if (Object.keys(latestByValidator).length < limit) {
            const needed = limit - Object.keys(latestByValidator).length;
            const pubKeys = validatorMeta.map(v => v.public_key);

            const queryStakeForValidator = async (pubKey: string, fromIso: string, toIso: string) => {
                const toolArguments = {
                    name: `projects/${GCP_PROJECT_ID}`,
                    filter: `metric.type = \"${METRIC_TYPE_STAKE}\" AND metric.labels.validator = \"${pubKey}\"`,
                    interval: { startTime: fromIso, endTime: toIso },
                };
                const toolCallResult = await mcpClient.callTool({ name: 'list_time_series', arguments: toolArguments });
                return parseTimeSeriesLatestValue(toolCallResult.content);
            };

            const stakeEntries: Array<{ public_key: string; amount: number }> = [];
            // Use expanded window for better coverage
            const fromIso = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
            for (const pk of pubKeys) {
                if (latestByValidator[pk] !== undefined) continue;
                try {
                    const amt = await queryStakeForValidator(pk, fromIso, queryEndTime);
                    if (amt && amt > 0) {
                        stakeEntries.push({ public_key: pk, amount: amt });
                    }
                } catch {
                    // ignore individual failures
                }
            }

            // Merge fallbacks
            for (const e of stakeEntries) {
                latestByValidator[e.public_key] = e.amount;
            }
        }
        const ranked = Object.entries(latestByValidator)
            .map(([public_key, total_stake_zil]) => ({
                public_key,
                total_stake_zil,
                name: byPubKey[public_key]?.name || undefined,
                zil_address: byPubKey[public_key]?.zil_address || undefined,
                address: byPubKey[public_key]?.address || undefined,
            }))
            .sort((a, b) => b.total_stake_zil - a.total_stake_zil)
            .slice(0, Math.max(1, limit));

        const response = {
            status: "success",
            data: {
                top_validators: ranked,
                message: `Top ${ranked.length}${ranked.length < limit ? ` of requested ${limit}` : ''} validators by stake${timeFrameText}.`,
            },
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
}

/**
 * Retrieves the top validators by proposer success rate within a time frame.
 * Computes total proposals and successful proposals per validator, then ranks by success rate.
 */
export async function getTopProposerSuccessRate(
    startTime?: string,
    endTime?: string,
    limit: number = 5,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    let timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    // Metadata keyed by public_key
    const validatorMeta = await getValidators();
    const byPubKey: Record<string, { name?: string; zil_address?: string; address?: string } > = {};
    for (const v of validatorMeta) {
        byPubKey[v.public_key] = { name: v.name, zil_address: v.zil_address, address: v.address };
    }

    return withMcpClient(async (mcpClient) => {
        const queryGroupedDelta = async (statusFilter: string, fromIso: string, toIso: string) => {
            const filter = `metric.type = \"${METRIC_TYPE_PROPOSALS}\" AND metric.labels.validator != "" ${statusFilter}`;
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter,
                interval: { startTime: fromIso, endTime: toIso },
                aggregation: {
                    alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                    perSeriesAligner: 'ALIGN_DELTA',
                },
            };
            const toolCallResult = await mcpClient.callTool({ name: 'list_time_series', arguments: toolArguments });
            return parseTimeSeriesGroupSum(toolCallResult.content, 'validator');
        };

        // Base window
        let totals = await queryGroupedDelta('', queryStartTime, queryEndTime);
        let proposed = await queryGroupedDelta('AND metric.labels.status = "proposed"', queryStartTime, queryEndTime);
        let missedNextMissed = await queryGroupedDelta('AND metric.labels.status = "missed_next_missed"', queryStartTime, queryEndTime);

        // Fallback: widen to 24h if fewer than requested and no explicit timeframe
        if ((!startTime && !endTime) && Object.keys(totals).length < limit) {
            const expandedStartIso = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
            totals = await queryGroupedDelta('', expandedStartIso, queryEndTime);
            proposed = await queryGroupedDelta('AND metric.labels.status = "proposed"', expandedStartIso, queryEndTime);
            missedNextMissed = await queryGroupedDelta('AND metric.labels.status = "missed_next_missed"', expandedStartIso, queryEndTime);
            timeFrameText = " in the last 24 hours";
        }

        const entries = Object.keys(totals).map((public_key) => {
            const total = totals[public_key] || 0;
            const success = (proposed[public_key] || 0) + (missedNextMissed[public_key] || 0);
            const rate = total > 0 ? (success / total) * 100 : undefined;
            return {
                public_key,
                proposer_success_rate: rate !== undefined ? `${rate.toFixed(2)}%` : 'N/A (0 proposals attempted)',
                name: byPubKey[public_key]?.name,
                zil_address: byPubKey[public_key]?.zil_address,
                address: byPubKey[public_key]?.address,
            };
        }).filter(e => e.proposer_success_rate !== 'N/A (0 proposals attempted)')
          .sort((a, b) => parseFloat(b.proposer_success_rate) - parseFloat(a.proposer_success_rate))
          .slice(0, Math.max(1, limit));

        const response = {
            status: "success",
            data: {
                top_validators: entries,
                message: `Top ${entries.length}${entries.length < limit ? ` of requested ${limit}` : ''} validators by proposer success rate${timeFrameText}.`,
            },
        };

        return { type: 'text', text: JSON.stringify(response) };
    });
}

/**
 * Retrieves the top validators by cosigner success rate within a time frame.
 * Computes total cosignatures and successful cosignatures per validator, then ranks by success rate.
 */
export async function getTopCosignerSuccessRate(
    startTime?: string,
    endTime?: string,
    limit: number = 5,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    let timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    const validatorMeta = await getValidators();
    const byPubKey: Record<string, { name?: string; zil_address?: string; address?: string } > = {};
    for (const v of validatorMeta) {
        byPubKey[v.public_key] = { name: v.name, zil_address: v.zil_address, address: v.address };
    }

    return withMcpClient(async (mcpClient) => {
        const queryGroupedDelta = async (cosignedFilter: string, fromIso: string, toIso: string) => {
            const filter = `metric.type = \"${METRIC_TYPE_COSIGNATURES}\" AND metric.labels.validator != "" ${cosignedFilter}`;
            const toolArguments = {
                name: `projects/${GCP_PROJECT_ID}`,
                filter,
                interval: { startTime: fromIso, endTime: toIso },
                aggregation: {
                    alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                    perSeriesAligner: 'ALIGN_DELTA',
                },
            };
            const toolCallResult = await mcpClient.callTool({ name: 'list_time_series', arguments: toolArguments });
            return parseTimeSeriesGroupSum(toolCallResult.content, 'validator');
        };

        let totals = await queryGroupedDelta('', queryStartTime, queryEndTime);
        let successful = await queryGroupedDelta('AND metric.labels.cosigned = "true"', queryStartTime, queryEndTime);

        if ((!startTime && !endTime) && Object.keys(totals).length < limit) {
            const expandedStartIso = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
            totals = await queryGroupedDelta('', expandedStartIso, queryEndTime);
            successful = await queryGroupedDelta('AND metric.labels.cosigned = "true"', expandedStartIso, queryEndTime);
            timeFrameText = " in the last 24 hours";
        }

        const entries = Object.keys(totals).map((public_key) => {
            const total = totals[public_key] || 0;
            const ok = successful[public_key] || 0;
            const rate = total > 0 ? (ok / total) * 100 : undefined;
            return {
                public_key,
                cosigner_success_rate: rate !== undefined ? `${rate.toFixed(2)}%` : 'N/A (0 cosignatures attempted)',
                name: byPubKey[public_key]?.name,
                zil_address: byPubKey[public_key]?.zil_address,
                address: byPubKey[public_key]?.address,
            };
        }).filter(e => e.cosigner_success_rate !== 'N/A (0 cosignatures attempted)')
          .sort((a, b) => parseFloat(b.cosigner_success_rate) - parseFloat(a.cosigner_success_rate))
          .slice(0, Math.max(1, limit));

        const response = {
            status: "success",
            data: {
                top_validators: entries,
                message: `Top ${entries.length}${entries.length < limit ? ` of requested ${limit}` : ''} validators by cosigner success rate${timeFrameText}.`,
            },
        };

        return { type: 'text', text: JSON.stringify(response) };
    });
}

/**
 * Retrieves the top validators by total earnings within a time frame.
 * Aggregates earnings across all validators and returns the top N.
 */
export async function getTopValidatorsByEarnings(
    startTime?: string,
    endTime?: string,
    limit: number = 5,
): Promise<{ content: ({ type: 'text', text: string })[] }> {
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);
    const timeFrameText = !startTime && !endTime ? " in the last hour" : ` between ${start.toISOString()} and ${end.toISOString()}`;
    const queryStartTime = start.toISOString();
    const queryEndTime = end.toISOString();

    // Fetch validator metadata to enrich results (name, zil_address)
    const validatorMeta = await getValidators();
    const byAddress: Record<string, { name?: string; zil_address?: string; public_key?: string } > = {};
    for (const v of validatorMeta) {
        byAddress[v.address] = { name: v.name, zil_address: v.zil_address, public_key: v.public_key };
    }

    return withMcpClient(async (mcpClient) => {
        const toolArguments = {
            name: `projects/${GCP_PROJECT_ID}`,
            filter: `metric.type = "${METRIC_TYPE_EARNINGS}" AND resource.type = "gce_instance" AND resource.labels.instance_id = "${GCE_INSTANCE_ID}"`,
            interval: {
                startTime: queryStartTime,
                endTime: queryEndTime,
            },
            aggregation: {
                alignmentPeriod: `${(end.getTime() - start.getTime()) / 1000}s`,
                perSeriesAligner: 'ALIGN_DELTA',
            },
        };

        const toolCallResult = await mcpClient.callTool({
            name: 'list_time_series',
            arguments: toolArguments,
        });

        const totalsByAddress = parseTimeSeriesGroupSum(toolCallResult.content, 'address');
        const ranked = Object.entries(totalsByAddress)
            .map(([address, total_earnings_zil]) => ({
                address,
                total_earnings_zil,
                name: byAddress[address]?.name || undefined,
                zil_address: byAddress[address]?.zil_address || undefined,
                public_key: byAddress[address]?.public_key || undefined,
            }))
            .sort((a, b) => b.total_earnings_zil - a.total_earnings_zil)
            .slice(0, Math.max(1, limit));

        const response = {
            status: "success",
            data: {
                top_validators: ranked,
                message: `Top ${ranked.length} validators by earnings${timeFrameText}.`,
            },
        };

        return {
            type: 'text',
            text: JSON.stringify(response),
        };
    });
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
    // Configuration for downstream MCP client
    const subMcpUrl = process.env.OBSERVABILITY_MCP_URL || "http://localhost:3000/mcp" ;
    const subMcpCommand = process.env.OBSERVABILITY_MCP_COMMAND || "node";
    const subMcpArgs = [process.env.OBSERVABILITY_MCP_ARGS || "../gcloud-mcp/packages/observability-mcp/dist/bundle.js"];

    const mcpClient = new Client({ name: "observability-mcp", version: "1.0.0" });
    
    let transport;
    if (subMcpUrl && (subMcpUrl.startsWith("http://") || subMcpUrl.startsWith("https://"))) {
        logger.debug(`Connecting to sub-MCP server via HTTP: ${subMcpUrl}`);
        transport = new StreamableHTTPClientTransport(new URL(subMcpUrl));
    } else {
        logger.debug(`Connecting to sub-MCP server via stdio: ${subMcpCommand} ${subMcpArgs}`);
        transport = new StdioClientTransport({
            command: subMcpCommand,
            args: subMcpArgs,
        });
    }

    try {
        await mcpClient.connect(transport);
        const result = await action(mcpClient);
        logger.debug("Received response from sub-MCP server.");
        const content = Array.isArray(result) ? result : [result];
        return { content };
    } catch (error) {
        logger.error(error as unknown as object, "ERROR during sub-MCP communication");
        const errorResponse = {
            status: "failed",
            reason: `Error calling downstream MCP: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
        return { content: [{ type: "text", text: JSON.stringify(errorResponse) }] };
    } finally {
        if (mcpClient) {
            logger.debug("Closing connection to sub-MCP server.");
            await mcpClient.close();
        }
    }
}
