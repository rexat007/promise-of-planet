import {
  extractRetrievalRequestFromTask,
  TaskToRetrievalAdapterError,
} from '../peia-worker/src/taskToRetrievalRequestAdapter';
import {
  SUPPORTED_KNOWLEDGE_SOURCES,
  PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH,
} from '../peia-worker/src/multiSourceKnowledgeRetrievalRouter';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${totalTests}. ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${totalTests}. ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

(async () => {
  console.log('--- RUNNING PEIA TASK TO RETRIEVAL REQUEST ADAPTER TESTS ---');

  // 1. Valid task with retrievalQuery succeeds
  await test('1. valid task with retrievalQuery extracts canonical request', () => {
    const task = {
      taskId: 'task-1',
      contentSnapshot: {
        retrievalQuery: 'coastal estuary sea surface temperature anomaly',
        title: 'Ignored Title',
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.query === 'coastal estuary sea surface temperature anomaly', 'Query mismatch');
    assert(Array.isArray(req.sources), 'Sources must be array');
    assert(req.sources.length === 2, 'Must contain 2 sources');
    assert(req.sources[0] === 'EPA' && req.sources[1] === 'NOAA', 'Sources must be EPA and NOAA');
  });

  // 2. Exact sources are the canonical EPA and NOAA
  await test('2. sources are exactly canonical SUPPORTED_KNOWLEDGE_SOURCES', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: 'clean water act phosphorus limit',
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.sources === SUPPORTED_KNOWLEDGE_SOURCES, 'Sources must match constant reference');
  });

  // 3. Missing retrievalQuery throws MISSING_RETRIEVAL_QUERY
  await test('3. missing retrievalQuery throws MISSING_RETRIEVAL_QUERY', () => {
    const task = {
      contentSnapshot: {
        title: 'Some Title',
        body: 'Some body text',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      assert((err as TaskToRetrievalAdapterError).code === 'MISSING_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 4. Empty retrievalQuery throws INVALID_RETRIEVAL_QUERY
  await test('4. empty retrievalQuery throws INVALID_RETRIEVAL_QUERY', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: '',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 5. Whitespace-only retrievalQuery throws INVALID_RETRIEVAL_QUERY
  await test('5. whitespace-only retrievalQuery throws INVALID_RETRIEVAL_QUERY', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: '   ',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 6. Leading/trailing whitespace is rejected (no auto-trim)
  await test('6. untrimmed leading/trailing whitespace rejected without heuristic repair', () => {
    const taskLeading = {
      contentSnapshot: {
        retrievalQuery: '  valid query',
      },
    };
    try {
      extractRetrievalRequestFromTask(taskLeading);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }

    const taskTrailing = {
      contentSnapshot: {
        retrievalQuery: 'valid query  ',
      },
    };
    try {
      extractRetrievalRequestFromTask(taskTrailing);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 7. Query exceeding 500 characters is rejected
  await test('7. query exceeding PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH (500) rejected without truncation', () => {
    const longQuery = 'a'.repeat(PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH + 1);
    const task = {
      contentSnapshot: {
        retrievalQuery: longQuery,
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 8. Exactly 500 characters is accepted
  await test('8. query of exact max length (500) accepted', () => {
    const maxQuery = 'a'.repeat(PEIA_MULTI_SOURCE_QUERY_MAX_LENGTH);
    const task = {
      contentSnapshot: {
        retrievalQuery: maxQuery,
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.query === maxQuery, 'Query mismatch');
  });

  // 9. Control characters in query rejected
  await test('9. control characters in query rejected without stripping', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: 'query with \n newline',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }

    const taskNullByte = {
      contentSnapshot: {
        retrievalQuery: 'query with \x00 null byte',
      },
    };
    try {
      extractRetrievalRequestFromTask(taskNullByte);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 10. Non-string types rejected
  await test('10. non-string retrievalQuery types rejected', () => {
    for (const invalidVal of [123, true, {}, [], null, undefined]) {
      const task = {
        contentSnapshot: {
          retrievalQuery: invalidVal,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed for ${typeof invalidVal}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      }
    }
  });

  // 11. No fallback to title
  await test('11. no heuristic fallback to contentSnapshot.title', () => {
    const task = {
      contentSnapshot: {
        title: 'Valid Environmental Title',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'MISSING_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 12. No fallback to body / text
  await test('12. no heuristic fallback to contentSnapshot.body or contentSnapshot.text', () => {
    const task = {
      contentSnapshot: {
        text: 'Valid text content',
        body: 'Valid body content',
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'MISSING_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 13. No fallback to claims[0]
  await test('13. no heuristic fallback to contentSnapshot.claims[0]', () => {
    const task = {
      contentSnapshot: {
        claims: ['Claim 1 about emissions', 'Claim 2'],
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'MISSING_RETRIEVAL_QUERY', 'Code mismatch');
    }
  });

  // 14. Malformed task payload rejected
  await test('14. non-object task or malformed contentSnapshot rejected with INVALID_TASK_PAYLOAD', () => {
    try {
      extractRetrievalRequestFromTask(null);
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_TASK_PAYLOAD', 'Code mismatch');
    }

    try {
      extractRetrievalRequestFromTask({ contentSnapshot: 'not-an-object' });
      assert(false, 'Should have failed');
    } catch (err) {
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_TASK_PAYLOAD', 'Code mismatch');
    }
  });

  // 15. Task object and contentSnapshot are not mutated
  await test('15. input task and contentSnapshot are not mutated', () => {
    const task = {
      taskId: 'task-immutable',
      contentSnapshot: {
        retrievalQuery: 'carbon footprint calculation',
        extraField: 42,
      },
    };
    const before = JSON.stringify(task);
    extractRetrievalRequestFromTask(task);
    const after = JSON.stringify(task);
    assert(before === after, 'Input must not be mutated');
  });

  console.log('------------------------------------------------------------');
  console.log(`TASK TO RETRIEVAL ADAPTER TESTS: ${passedTests}/${totalTests} PASSED`);
})();
