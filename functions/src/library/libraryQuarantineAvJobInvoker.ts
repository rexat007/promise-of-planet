import {
  parseLibraryQuarantineIsolatedInspectionRequestId,
  type LibraryQuarantineAvExecutionFailureReasonCode,
} from './libraryQuarantineAvExecutionContract';

export const LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR =
  'POP_QUARANTINE_AV_REQUEST_ID' as const;

export const LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR =
  'POP_QUARANTINE_AV_JOB_PROJECT_ID' as const;

export const LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR =
  'POP_QUARANTINE_AV_JOB_REGION' as const;

export const LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR =
  'POP_QUARANTINE_AV_JOB_NAME' as const;

const SAFE_GCP_IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SAFE_EXECUTION_NAME_REGEX = /^[A-Za-z0-9/_.:-]{1,256}$/;

const DETERMINISTIC_PRE_LAUNCH_HTTP_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 422,
]);

export interface CloudRunJobConfig {
  readonly projectId: string;
  readonly region: string;
  readonly jobName: string;
}

export interface InvokeQuarantineAvJobLaunchedResult {
  readonly status: 'LAUNCHED';
  readonly executionName: string | null;
}

export interface InvokeQuarantineAvJobPreLaunchFailedResult {
  readonly status: 'PRE_LAUNCH_FAILED';
  readonly failureReasonCode:
    | 'JOB_CONFIG_MISSING_OR_INVALID'
    | 'IAM_PRECONDITION_FAILED';
  readonly errorMessage: string;
}

export interface InvokeQuarantineAvJobApiRejectedResult {
  readonly status: 'API_REJECTED';
  readonly failureReasonCode:
    | 'IAM_PRECONDITION_FAILED'
    | 'JOB_LAUNCH_REJECTED';
  readonly httpStatus: number;
  readonly errorMessage: string;
}

export interface InvokeQuarantineAvJobUnknownResult {
  readonly status: 'DISPATCH_UNKNOWN';
  readonly failureReasonCode: 'JOB_LAUNCH_UNCERTAIN';
  readonly errorMessage: string;
}

export type InvokeQuarantineAvJobResult =
  | InvokeQuarantineAvJobLaunchedResult
  | InvokeQuarantineAvJobPreLaunchFailedResult
  | InvokeQuarantineAvJobApiRejectedResult
  | InvokeQuarantineAvJobUnknownResult;

export interface LibraryQuarantineAvJobInvoker {
  validateConfig():
    | { readonly ok: true; readonly config: CloudRunJobConfig }
    | {
        readonly ok: false;
        readonly failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID';
        readonly errorMessage: string;
      };
  invokeAvJobForRequest(requestId: string): Promise<InvokeQuarantineAvJobResult>;
}

export interface GoogleCloudRunQuarantineAvJobInvokerOptions {
  readonly projectId?: string;
  readonly region?: string;
  readonly jobName?: string;
  readonly accessTokenProvider?: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function isValidGcpIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_GCP_IDENTIFIER_REGEX.test(value);
}

async function defaultMetadataOrAdminAccessTokenProvider(): Promise<string> {
  const metadataResponse = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      method: 'GET',
      headers: {
        'Metadata-Flavor': 'Google',
      },
    }
  );
  if (!metadataResponse.ok) {
    throw new Error(
      `Failed to obtain GCP service account token (HTTP ${metadataResponse.status}).`
    );
  }
  const body = (await metadataResponse.json()) as {
    readonly access_token?: unknown;
  };
  if (
    !body ||
    typeof body.access_token !== 'string' ||
    body.access_token.trim().length === 0
  ) {
    throw new Error('Metadata server returned empty access_token.');
  }
  return body.access_token.trim();
}

export function buildCloudRunJobRunRequestBody(requestId: string): {
  readonly overrides: {
    readonly containerOverrides: readonly [
      {
        readonly env: readonly [
          {
            readonly name: typeof LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR;
            readonly value: string;
          },
        ];
      },
    ];
    readonly taskCount: 1;
    readonly timeout: '600s';
  };
} {
  const parsed = parseLibraryQuarantineIsolatedInspectionRequestId(requestId);
  if (!parsed) {
    throw new Error(
      'INVALID_REQUEST_ID: Cannot build Cloud Run Job overrides for malformed requestId.'
    );
  }
  return Object.freeze({
    overrides: Object.freeze({
      containerOverrides: Object.freeze([
        Object.freeze({
          env: Object.freeze([
            Object.freeze({
              name: LIBRARY_QUARANTINE_AV_REQUEST_ID_ENV_VAR,
              value: parsed.requestId,
            }),
          ] as const),
        }),
      ] as const),
      taskCount: 1 as const,
      timeout: '600s' as const,
    }),
  });
}

export class GoogleCloudRunQuarantineAvJobInvoker
  implements LibraryQuarantineAvJobInvoker
{
  private readonly projectId: string;
  private readonly region: string;
  private readonly jobName: string;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GoogleCloudRunQuarantineAvJobInvokerOptions = {}) {
    this.projectId =
      options.projectId ??
      process.env[LIBRARY_QUARANTINE_AV_JOB_PROJECT_ENV_VAR] ??
      '';
    this.region =
      options.region ??
      process.env[LIBRARY_QUARANTINE_AV_JOB_REGION_ENV_VAR] ??
      '';
    this.jobName =
      options.jobName ??
      process.env[LIBRARY_QUARANTINE_AV_JOB_NAME_ENV_VAR] ??
      '';
    this.accessTokenProvider =
      options.accessTokenProvider ?? defaultMetadataOrAdminAccessTokenProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs =
      typeof options.timeoutMs === 'number' &&
      Number.isSafeInteger(options.timeoutMs) &&
      options.timeoutMs >= 500 &&
      options.timeoutMs <= 30_000
        ? options.timeoutMs
        : 10_000;
  }

  public validateConfig():
    | { readonly ok: true; readonly config: CloudRunJobConfig }
    | {
        readonly ok: false;
        readonly failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID';
        readonly errorMessage: string;
      } {
    if (
      !isValidGcpIdentifier(this.projectId) ||
      !isValidGcpIdentifier(this.region) ||
      !isValidGcpIdentifier(this.jobName)
    ) {
      return Object.freeze({
        ok: false as const,
        failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID' as const,
        errorMessage:
          'Cloud Run Job configuration (projectId, region, jobName) is missing or invalid on the server.',
      });
    }

    return Object.freeze({
      ok: true as const,
      config: Object.freeze({
        projectId: this.projectId,
        region: this.region,
        jobName: this.jobName,
      }),
    });
  }

  public async invokeAvJobForRequest(
    requestId: string
  ): Promise<InvokeQuarantineAvJobResult> {
    const parsed = parseLibraryQuarantineIsolatedInspectionRequestId(requestId);
    if (!parsed) {
      return Object.freeze({
        status: 'PRE_LAUNCH_FAILED' as const,
        failureReasonCode: 'JOB_CONFIG_MISSING_OR_INVALID' as const,
        errorMessage:
          'Invalid isolated inspection requestId for Cloud Run Job invocation.',
      });
    }

    const configCheck = this.validateConfig();
    if (!configCheck.ok) {
      return Object.freeze({
        status: 'PRE_LAUNCH_FAILED' as const,
        failureReasonCode: configCheck.failureReasonCode,
        errorMessage: configCheck.errorMessage,
      });
    }

    let accessToken: string;
    try {
      accessToken = await this.accessTokenProvider();
    } catch {
      return Object.freeze({
        status: 'PRE_LAUNCH_FAILED' as const,
        failureReasonCode: 'IAM_PRECONDITION_FAILED' as const,
        errorMessage:
          'Failed to acquire server IAM access token for Cloud Run Jobs API.',
      });
    }

    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      return Object.freeze({
        status: 'PRE_LAUNCH_FAILED' as const,
        failureReasonCode: 'IAM_PRECONDITION_FAILED' as const,
        errorMessage:
          'Server IAM access token provider returned an empty credential.',
      });
    }

    const { projectId, region, jobName } = configCheck.config;
    const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${jobName}:run`;
    const bodyObj = buildCloudRunJobRunRequestBody(parsed.requestId);
    const serializedBody = JSON.stringify(bodyObj);

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          'Content-Type': 'application/json',
        },
        body: serializedBody,
        signal: abortController.signal,
      });
    } catch {
      clearTimeout(timeoutHandle);
      // Network timeout or connection drop after sending POST -> outcome is uncertain, zero auto-retry
      return Object.freeze({
        status: 'DISPATCH_UNKNOWN' as const,
        failureReasonCode: 'JOB_LAUNCH_UNCERTAIN' as const,
        errorMessage:
          'Cloud Run Job launch request timed out or lost network connection; verify execution status via GET before retrying.',
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (response.status >= 200 && response.status < 300) {
      let parsedJson: Record<string, unknown> | null = null;
      try {
        const rawJson = await response.json();
        if (
          typeof rawJson === 'object' &&
          rawJson !== null &&
          !Array.isArray(rawJson)
        ) {
          parsedJson = rawJson as Record<string, unknown>;
        }
      } catch {
        // 2xx received from Cloud Run Jobs API, so job launch succeeded even if body parsing failed
        return Object.freeze({
          status: 'LAUNCHED' as const,
          executionName: null,
        });
      }

      const rawName =
        parsedJson && typeof parsedJson.name === 'string'
          ? parsedJson.name.trim()
          : null;
      const safeExecutionName =
        rawName && SAFE_EXECUTION_NAME_REGEX.test(rawName) ? rawName : null;

      return Object.freeze({
        status: 'LAUNCHED' as const,
        executionName: safeExecutionName,
      });
    }

    if (DETERMINISTIC_PRE_LAUNCH_HTTP_STATUSES.has(response.status)) {
      const reasonCode: LibraryQuarantineAvExecutionFailureReasonCode =
        response.status === 401 || response.status === 403
          ? 'IAM_PRECONDITION_FAILED'
          : 'JOB_LAUNCH_REJECTED';

      return Object.freeze({
        status: 'API_REJECTED' as const,
        failureReasonCode: reasonCode,
        httpStatus: response.status,
        errorMessage:
          reasonCode === 'IAM_PRECONDITION_FAILED'
            ? `Cloud Run Jobs API rejected caller IAM permissions (HTTP ${response.status}).`
            : `Cloud Run Jobs API rejected job launch request prior to execution (HTTP ${response.status}).`,
      });
    }

    // 408, 409, 429, 5xx -> ambiguous whether Cloud Run started the job task; treat as DISPATCH_UNKNOWN
    return Object.freeze({
      status: 'DISPATCH_UNKNOWN' as const,
      failureReasonCode: 'JOB_LAUNCH_UNCERTAIN' as const,
      errorMessage: `Cloud Run Jobs API returned ambiguous status HTTP ${response.status}; verify execution status via GET without retrying.`,
    });
  }
}
