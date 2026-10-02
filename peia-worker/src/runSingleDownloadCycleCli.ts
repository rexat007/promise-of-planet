import { loadProductionConfig, WorkerRuntimeConfigError } from './workerRuntimeConfig';
import { runSingleDownloadCycle } from './singleDownloadCycle';
import { PendingTaskHttpDownloadTransportError } from './pendingTaskHttpDownloadTransport';
import { PendingTaskDownloadResponseError } from './downloadTaskResponseContract';
import { SqlitePendingTaskRepositoryError } from './sqlitePendingTaskRepository';
import { LocalPendingTaskStoreContractError } from './localPendingTaskStoreContract';

export interface SingleDownloadCycleCliDependencies {
  loadConfig: typeof loadProductionConfig;
  runCycle: typeof runSingleDownloadCycle;
  writeStdout: (data: string) => void;
  writeStderr: (data: string) => void;
}

export async function runSingleDownloadCycleCliWithDependencies(
  deps: SingleDownloadCycleCliDependencies
): Promise<number> {
  try {
    const config = deps.loadConfig();
    const result = await deps.runCycle({
      databasePath: config.databasePath,
      download: {
        endpointUrl: config.endpointUrl,
        credential: config.credential,
      },
    });

    if (result.kind === 'STORED') {
      const output = {
        kind: 'STORED',
        taskId: result.record.taskId,
      };
      deps.writeStdout(JSON.stringify(output));
    } else {
      const output = {
        kind: 'NO_TASK',
      };
      deps.writeStdout(JSON.stringify(output));
    }
    return 0;
  } catch (error: any) {
    let exitCode = 5;
    let category = 'UNEXPECTED';
    let code = 'UNEXPECTED_ERROR';
    let message = 'An unexpected error occurred.';

    if (error instanceof WorkerRuntimeConfigError) {
      exitCode = 2;
      category = 'CONFIG';
      code = error.code;
      message = error.message;
    } else if (
      error instanceof PendingTaskHttpDownloadTransportError ||
      error instanceof PendingTaskDownloadResponseError
    ) {
      exitCode = 3;
      category = 'NETWORK_OR_RESPONSE';
      code = error.code;
      message = error.message;
    } else if (
      error instanceof SqlitePendingTaskRepositoryError ||
      error instanceof LocalPendingTaskStoreContractError
    ) {
      exitCode = 4;
      category = 'LOCAL_STORE';
      code = error.code;
      message = error.message;
    }

    const errorRecord = {
      category,
      code,
      message,
    };

    deps.writeStderr(JSON.stringify(errorRecord));
    return exitCode;
  }
}

async function main() {
  const exitCode = await runSingleDownloadCycleCliWithDependencies({
    loadConfig: loadProductionConfig,
    runCycle: runSingleDownloadCycle,
    writeStdout: console.log,
    writeStderr: console.error,
  });
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}
