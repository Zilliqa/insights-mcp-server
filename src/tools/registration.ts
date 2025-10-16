import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validators, ValidatorData } from './validators.js';
import {
  getTotalValidatorEarnings,
  getValidatorEarningsBreakdown,
  getValidatorStake,
  getProposerSuccessRate,
  getCosignerSuccessRate,
} from './index.js';

type ToolHandler<T extends { validator: string }> = (
  params: T,
  validatorInfo: ValidatorData
) => Promise<any>;

/**
 * A higher-order function that wraps a tool's implementation with validator resolution logic.
 * It finds the validator based on the input and handles the case where the validator is not found.
 * @param handler The core logic of the tool to be executed if the validator is found.
 * @returns An async function that can be used as the tool's implementation.
 */
function withValidatorResolution<T extends { validator: string }>(
  handler: ToolHandler<T>
) {
  return async (params: T) => {
    const validatorInfo = findValidator(params.validator);
    if (!validatorInfo) {
      return { content: [{ type: 'text', text: JSON.stringify({ status: "failed", reason: `Validator '${params.validator}' not found.` }) }] };
    }
    return handler(params, validatorInfo);
  };
}

/**
 * Finds a validator by name, public key, address, or zil_address.
 * @param identifier The name, public key, address, or zil_address of the validator.
 * @returns The validator object if found, otherwise undefined.
 */
function findValidator(identifier: string) {
  const normalizedIdentifier = identifier.toLowerCase();
  return validators.find(
    (v) =>
      v.name.toLowerCase() === normalizedIdentifier ||
      v.public_key.toLowerCase() === normalizedIdentifier ||
      v.address.toLowerCase() === normalizedIdentifier ||
      v.zil_address.toLowerCase() === normalizedIdentifier
  );
}

export const registerTools = (server: McpServer): void => {
  server.tool(
    "get_validator_info",
    "Gets all available information for a validator (name, public key, address, zil_address) by providing any one of those identifiers.",
    {
      validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return { content: [{ type: 'text', text: JSON.stringify({ status: "success", data: validatorInfo }) }] };
    })
  );

  server.tool(
    "get_total_validator_earnings",
    "Gets the total earnings for a specific validator. If startTime and endTime are not provided, it defaults to the last hour.",
    {
        validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
        startTime: z.string().describe("The start of the time range in ISO 8601 format. Defaults to 1 hour ago if not provided.").optional(),
        endTime: z.string().describe("The end of the time range in ISO 8601 format. Defaults to the current time if not provided.").optional(),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return getTotalValidatorEarnings(validatorInfo.address, params.startTime, params.endTime);
    }),
  );

  server.tool(
    "get_validator_earnings_breakdown",
    "Provides a detailed breakdown of a validator's earnings, separating rewards from block proposals and cosignatures. If startTime and endTime are not provided, it defaults to the last hour.",
    {
        validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
        startTime: z.string().describe("The start of the time range in ISO 8601 format. Defaults to 1 hour ago if not provided.").optional(),
        endTime: z.string().describe("The end of the time range in ISO 8601 format. Defaults to the current time if not provided.").optional(),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return getValidatorEarningsBreakdown(validatorInfo.address, params.startTime, params.endTime);
    }),
  );

  server.tool(
    "get_validator_stake",
    "Retrieves the total amount of ZIL currently delegated to a validator, representing their weight in the consensus mechanism.",
    {
        validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return getValidatorStake(validatorInfo.public_key);
    }),
  );

  server.tool(
    "get_proposer_success_rate",
    "Measures a validator's performance specifically when tasked with proposing a new block. A 100% proposer success rate is the gold standard. A missed proposal means a delay in the chain and lost rewards for that validator. This metric is a critical indicator of a validator's node stability and network latency. If startTime and endTime are not provided, it defaults to the last hour.",
    {
        validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
        startTime: z.string().describe("The start of the time range in ISO 8601 format. Defaults to 1 hour ago if not provided.").optional(),
        endTime: z.string().describe("The end of the time range in ISO 8601 format. Defaults to the current time if not provided.").optional(),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return getProposerSuccessRate(validatorInfo.public_key, params.startTime, params.endTime);
    }),
  );

  server.tool(
    "get_cosigner_success_rate",
    "Measures a validator's performance when tasked with cosigning (attesting to) a block proposed by another validator. Cosigning is the most frequent duty. A high success rate demonstrates consistent uptime and connectivity. Even a small dip here can lead to a noticeable reduction in rewards over time. If startTime and endTime are not provided, it defaults to the last hour.",
    {
        validator: z.string().describe("The name, public key, address, or zil_address of the validator."),
        startTime: z.string().describe("The start of the time range in ISO 8601 format. Defaults to 1 hour ago if not provided.").optional(),
        endTime: z.string().describe("The end of the time range in ISO 8601 format. Defaults to the current time if not provided.").optional(),
    },
    withValidatorResolution(async (params, validatorInfo) => {
      return getCosignerSuccessRate(validatorInfo.public_key, params.startTime, params.endTime);
    }),
  );

};
