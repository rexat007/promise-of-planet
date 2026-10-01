import { loadProductionConfig, WorkerRuntimeConfigError } from './workerRuntimeConfig';
import { runSingleDownloadCycle } from './singleDownloadCycle';
import { PendingTaskHttpDownloadTransportError } from './pendingTaskHttpDownloadTransport';
import { PendingTaskDownloadResponseError } from './downloadTaskResponseContract';
import { SqlitePendingTaskRepositoryError } from './sqlitePendingTaskRepository';
import { LocalPendingTaskStoreContractError } from './localPendingTaskStoreContract';

async function main() {
  try {
    const config = loadProductionConfig();
    const result = await runSingleDownloadCycle({
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
      console.log(JSON.stringify(output));
    } else {
      const output = {
        kind: 'NO_TASK',
      };
      console.log(JSON.stringify(output));
    }
    process.exit(0);
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

    console.error(JSON.stringify(errorRecord));

    if (exitCode === 5) {
      console.error(error);
    }

    process.exit(exitCode);
  }
}

main();
