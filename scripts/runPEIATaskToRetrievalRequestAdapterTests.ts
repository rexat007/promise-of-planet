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

  // 16. Absent retrievalSources preserves legacy SUPPORTED_KNOWLEDGE_SOURCES constant reference
  await test('16. absent retrievalSources preserves exact legacy constant reference', () => {
    const task = {
      taskId: 'task-legacy',
      contentSnapshot: {
        retrievalQuery: 'methane leakage in permafrost',
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.sources === SUPPORTED_KNOWLEDGE_SOURCES, 'Must return identical constant reference');
    assert(req.sources.length === 2, 'Must have 2 sources');
    assert(req.sources[0] === 'EPA' && req.sources[1] === 'NOAA', 'Must be EPA and NOAA');
  });

  // 17. Explicit retrievalSources: ['NOAA'] extracts single NOAA source
  await test('17. explicit retrievalSources: [NOAA] extracts single NOAA source', () => {
    const task = {
      taskId: 'task-noaa-only',
      contentSnapshot: {
        retrievalQuery: 'atmospheric co2 mauna loa observatory',
        retrievalSources: ['NOAA'],
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.query === 'atmospheric co2 mauna loa observatory', 'Query mismatch');
    assert(Array.isArray(req.sources), 'Must be array');
    assert(req.sources.length === 1, 'Length must be 1');
    assert(req.sources[0] === 'NOAA', 'Must be NOAA');
    assert(Object.isFrozen(req.sources), 'Resulting sources must be frozen');
  });

  // 18. Explicit retrievalSources: ['EPA'] extracts single EPA source
  await test('18. explicit retrievalSources: [EPA] extracts single EPA source', () => {
    const task = {
      taskId: 'task-epa-only',
      contentSnapshot: {
        retrievalQuery: 'clean air act particulate matter standard',
        retrievalSources: ['EPA'],
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.query === 'clean air act particulate matter standard', 'Query mismatch');
    assert(Array.isArray(req.sources), 'Must be array');
    assert(req.sources.length === 1, 'Length must be 1');
    assert(req.sources[0] === 'EPA', 'Must be EPA');
    assert(Object.isFrozen(req.sources), 'Resulting sources must be frozen');
  });

  // 19. Explicit retrievalSources: ['NOAA', 'EPA'] preserves requested order
  await test('19. explicit retrievalSources: [NOAA, EPA] preserves requested order', () => {
    const task = {
      taskId: 'task-noaa-epa',
      contentSnapshot: {
        retrievalQuery: 'ocean acidification coral calcification rate',
        retrievalSources: ['NOAA', 'EPA'],
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.sources.length === 2, 'Length must be 2');
    assert(req.sources[0] === 'NOAA', 'First source must be NOAA');
    assert(req.sources[1] === 'EPA', 'Second source must be EPA');
    assert(Object.isFrozen(req.sources), 'Resulting sources must be frozen');
  });

  // 20. Explicit retrievalSources: ['EPA', 'NOAA'] extracts both sources
  await test('20. explicit retrievalSources: [EPA, NOAA] extracts both sources', () => {
    const task = {
      taskId: 'task-epa-noaa',
      contentSnapshot: {
        retrievalQuery: 'wetland restoration carbon sequestration',
        retrievalSources: ['EPA', 'NOAA'],
      },
    };
    const req = extractRetrievalRequestFromTask(task);
    assert(req.sources.length === 2, 'Length must be 2');
    assert(req.sources[0] === 'EPA', 'First source must be EPA');
    assert(req.sources[1] === 'NOAA', 'Second source must be NOAA');
    assert(Object.isFrozen(req.sources), 'Resulting sources must be frozen');
  });

  // 21. Non-array retrievalSources rejected with INVALID_RETRIEVAL_SOURCES
  await test('21. non-array retrievalSources rejected with INVALID_RETRIEVAL_SOURCES', () => {
    const invalidValues = ['NOAA', 123, true, false, null, { 0: 'NOAA' }];
    for (const val of invalidValues) {
      const task = {
        contentSnapshot: {
          retrievalQuery: 'valid query',
          retrievalSources: val,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed for ${typeof val}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
        assert(
          (err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES',
          `Expected INVALID_RETRIEVAL_SOURCES for ${typeof val}`
        );
      }
    }
  });

  // 22. Empty array retrievalSources rejected with INVALID_RETRIEVAL_SOURCES
  await test('22. empty array retrievalSources rejected with INVALID_RETRIEVAL_SOURCES', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: 'valid query',
        retrievalSources: [],
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed for empty array');
    } catch (err) {
      assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES', 'Code mismatch');
    }
  });

  // 23. retrievalSources with non-string elements rejected with INVALID_RETRIEVAL_SOURCES
  await test('23. retrievalSources with non-string elements rejected with INVALID_RETRIEVAL_SOURCES', () => {
    const invalidArrays = [[123], [null], [undefined], [{}], ['NOAA', 42], [true, 'EPA']];
    for (const arr of invalidArrays) {
      const task = {
        contentSnapshot: {
          retrievalQuery: 'valid query',
          retrievalSources: arr,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed for ${JSON.stringify(arr)}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
        assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES', 'Code mismatch');
      }
    }
  });

  // 24. Explicit assertions for unsupported source names throwing UNSUPPORTED_RETRIEVAL_SOURCE
  await test('24. explicit unsupported sources [USGS], [NASA], [noaa], [epa] throw UNSUPPORTED_RETRIEVAL_SOURCE', () => {
    const requiredUnsupported = [
      { source: ['USGS'], name: 'USGS' },
      { source: ['NASA'], name: 'NASA' },
      { source: ['noaa'], name: 'lowercase noaa' },
      { source: ['epa'], name: 'lowercase epa' },
      { source: ['DOE'], name: 'DOE' },
      { source: ['WEATHER'], name: 'WEATHER' },
      { source: ['IPCC'], name: 'IPCC' },
      { source: ['UNKNOWN'], name: 'UNKNOWN' },
    ];

    for (const item of requiredUnsupported) {
      const task = {
        contentSnapshot: {
          retrievalQuery: 'valid query',
          retrievalSources: item.source,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed with UNSUPPORTED_RETRIEVAL_SOURCE for ${item.name}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
        assert(
          (err as TaskToRetrievalAdapterError).code === 'UNSUPPORTED_RETRIEVAL_SOURCE',
          `Expected UNSUPPORTED_RETRIEVAL_SOURCE for ${item.name}, got ${(err as TaskToRetrievalAdapterError).code}`
        );
      }
    }
  });

  // 25. Padded or untrimmed canonical values throw INVALID_RETRIEVAL_SOURCES
  await test('25. padded or untrimmed canonical source [ NOAA ] throws INVALID_RETRIEVAL_SOURCES', () => {
    const paddedSources = [
      [' NOAA '],
      ['EPA '],
      [' NOAA'],
      [' EPA '],
      [''],
    ];

    for (const arr of paddedSources) {
      const task = {
        contentSnapshot: {
          retrievalQuery: 'valid query',
          retrievalSources: arr,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed for padded ${JSON.stringify(arr)}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
        assert(
          (err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES',
          `Expected INVALID_RETRIEVAL_SOURCES for ${JSON.stringify(arr)}, got ${(err as TaskToRetrievalAdapterError).code}`
        );
      }
    }
  });

  // 26. retrievalSources with duplicate sources rejected with INVALID_RETRIEVAL_SOURCES
  await test('26. retrievalSources with duplicate sources rejected with INVALID_RETRIEVAL_SOURCES', () => {
    const duplicates = [['NOAA', 'NOAA'], ['EPA', 'EPA']];
    for (const arr of duplicates) {
      const task = {
        contentSnapshot: {
          retrievalQuery: 'valid query',
          retrievalSources: arr,
        },
      };
      try {
        extractRetrievalRequestFromTask(task);
        assert(false, `Should have failed for duplicate ${JSON.stringify(arr)}`);
      } catch (err) {
        assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
        assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES', 'Code mismatch');
      }
    }
  });

  // 27. retrievalSources exceeding maximum supported source count rejected
  await test('27. retrievalSources exceeding maximum supported source count rejected', () => {
    const task = {
      contentSnapshot: {
        retrievalQuery: 'valid query',
        retrievalSources: ['EPA', 'NOAA', 'EPA'],
      },
    };
    try {
      extractRetrievalRequestFromTask(task);
      assert(false, 'Should have failed for array length > 2');
    } catch (err) {
      assert(err instanceof TaskToRetrievalAdapterError, 'Must be TaskToRetrievalAdapterError');
      assert((err as TaskToRetrievalAdapterError).code === 'INVALID_RETRIEVAL_SOURCES', 'Code mismatch');
    }
  });

  // 28. Input task, contentSnapshot, and retrievalSources are not mutated
  await test('28. input retrievalSources array and task structure are not mutated', () => {
    const originalSources = ['NOAA', 'EPA'];
    const task = {
      taskId: 'task-immutable-sources',
      contentSnapshot: {
        retrievalQuery: 'cryosphere mass loss trends',
        retrievalSources: originalSources,
      },
    };
    const taskBefore = JSON.stringify(task);
    const sourcesBefore = [...originalSources];

    const req = extractRetrievalRequestFromTask(task);

    const taskAfter = JSON.stringify(task);
    assert(taskBefore === taskAfter, 'Task must not be mutated');
    assert(originalSources.length === sourcesBefore.length, 'Original sources length must not change');
    assert(originalSources[0] === sourcesBefore[0] && originalSources[1] === sourcesBefore[1], 'Original sources content unchanged');
    assert(req.sources !== originalSources, 'Returned sources must be a detached array');
  });

  console.log('------------------------------------------------------------');
  console.log(`TASK TO RETRIEVAL ADAPTER TESTS: ${passedTests}/${totalTests} PASSED`);
})();

