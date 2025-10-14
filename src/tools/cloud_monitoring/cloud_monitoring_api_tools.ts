import { MetricServiceClient } from '@google-cloud/monitoring';

// --- Constants for Google Cloud Monitoring ---
const GCP_PROJECT_ID = "prj-p-devops-services-tvwmrf63";
const GCE_INSTANCE_ID = "7753770768243446498";
const METRIC_TYPE = "workload.googleapis.com/validator_earned_reward";
const RESOURCE_TYPE = "gce_instance";

/**
 * Gets the total earnings for a specific validator within a given time range.
 * @param validator The address of the validator.
 * @param startTime The start of the time range in ISO 8601 format.
 * @param endTime The end of the time range in ISO 8601 format.
 * @returns A promise that resolves with the tool's response content.
 * @returns A promise that resolves with the total summed earnings.
 */
export async function getTotalValidatorEarnings(
  validator: string,
  startTime?: string,
  endTime?: string,
): Promise<{ content: any[] }> {
    // Initialize the Google Cloud Monitoring client.
    const monitoringClient = new MetricServiceClient();

    // Set default time range: If endTime is not provided, use the current time.
    // If startTime is not provided, use 1 hour before the end time.
    const end = endTime ? new Date(endTime) : new Date();
    const start = startTime ? new Date(startTime) : new Date(end.getTime() - 60 * 60 * 1000);

    try {
        // Fetch time series data from Google Cloud Monitoring.
        const [timeSeries] = await monitoringClient.listTimeSeries({
            name: `projects/${GCP_PROJECT_ID}`,
            filter: `metric.type = "${METRIC_TYPE}" AND metric.labels.address = "${validator}" AND resource.type = "${RESOURCE_TYPE}" AND resource.labels.instance_id = "${GCE_INSTANCE_ID}"`,
            interval: {
                startTime: {
                    seconds: start.getTime() / 1000,
                },
                endTime: {
                    seconds: end.getTime() / 1000,
                },
            },
            // Aggregation is used to sum up the metric values over the specified time range.
            // ALIGN_DELTA calculates the change in value over the alignment period.
            aggregation: {
                alignmentPeriod: { seconds: (end.getTime() - start.getTime()) / 1000 },
                perSeriesAligner: 'ALIGN_DELTA',
            },
        });

        const sum = timeSeries.reduce((acc, series) => {
            // Safely access the value from the time series points and add it to the accumulator.
            if (series?.points?.[0]?.value?.doubleValue) {
                return acc + series.points[0].value.doubleValue;
            }
            return acc;
        }, 0);

        const response = {
            // Construct the successful response object in the desired JSON format.
            status: "success",
            data: {
                total_earnings_zil: sum,
            },
        };

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(response),
                },
            ],
        };
    } catch (error) {
        // Catch any errors during the API call and format a failed response.
        console.error("Error fetching time series data:", error);
        const errorResponse = {
            status: "failed",
            reason: error instanceof Error ? error.message : 'Unknown error'
        };
        return { content: [{ type: "text", text: JSON.stringify(errorResponse) }] };
    }
}