export interface WorkerRuntimeConfig {
  readonly endpointUrl: string;
  readonly databasePath: string;
  readonly credential: string;
}

export class WorkerRuntimeConfigError extends Error {
  readonly code = 'INVALID_RUNTIME_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'WorkerRuntimeConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): WorkerRuntimeConfig {
  const endpointUrl = env.PEIA_TASK_ENDPOINT_URL;
  const databasePath = env.PEIA_LOCAL_DATABASE_PATH;
  const credential = env.PEIA_MACHINE_CREDENTIAL;

  if (typeof endpointUrl !== 'string') {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_TASK_ENDPOINT_URL is missing or not a string.');
  }
  if (endpointUrl.length === 0 || endpointUrl !== endpointUrl.trim()) {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_TASK_ENDPOINT_URL must be a non-empty, trimmed string.');
  }

  if (typeof databasePath !== 'string') {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_LOCAL_DATABASE_PATH is missing or not a string.');
  }
  if (databasePath.length === 0 || databasePath !== databasePath.trim()) {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_LOCAL_DATABASE_PATH must be a non-empty, trimmed string.');
  }

  if (typeof credential !== 'string') {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_MACHINE_CREDENTIAL is missing or not a string.');
  }
  if (credential.length === 0 || /\s/.test(credential)) {
    throw new WorkerRuntimeConfigError('Invalid configuration: PEIA_MACHINE_CREDENTIAL must be a non-empty string with no whitespace, CR, or LF.');
  }

  return {
    endpointUrl,
    databasePath,
    credential,
  };
}

export function loadProductionConfig(): WorkerRuntimeConfig {
  return loadRuntimeConfig(process.env);
}
