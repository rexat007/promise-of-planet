import {
  createNOAAHttpKnowledgeTransport,
  parseNCEIDatasetsResponse,
  validateNOAATransportRequest,
  isValidNOAAUrl,
  NCEI_DATASETS_ENDPOINT,
} from '../peia-worker/src/noaaHttpKnowledgeTransport';
import {
  retrieveFromNOAASource,
  NOAARetrievalError,
  NOAA_QUERY_MAX_LENGTH,
} from '../peia-worker/src/noaaKnowledgeRetrievalBoundary';

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
  console.log('--- RUNNING PEIA NOAA HTTP KNOWLEDGE TRANSPORT TESTS ---');

  // 1. valid query builds exact NCEI URL with encoded text
  await test('1. valid query builds exact NCEI URL with encoded text', async () => {
    let capturedUrl = '';
    const fakeFetch = async (url: string | URL) => {
      capturedUrl = String(url);
      return {
        status: 200,
        async json() {
          return { results: [] };
        },
      };
    };

    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    await transport({ query: 'sea surface temperature anomaly' });

    assert(
      capturedUrl === `${NCEI_DATASETS_ENDPOINT}?text=${encodeURIComponent('sea surface temperature anomaly')}`,
      'URL must match expected NCEI endpoint with encoded query'
    );
  });

  // 2. GET method
  await test('2. GET method used', async () => {
    let capturedMethod = '';
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      capturedMethod = init?.method || '';
      return {
        status: 200,
        async json() {
          return { results: [] };
        },
      };
    };

    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    await transport({ query: 'climate' });

    assert(capturedMethod === 'GET', 'Method must be GET');
  });

  // 3. Accept application/json and User-Agent
  await test('3. Accept application/json and User-Agent headers set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        status: 200,
        async json() {
          return { results: [] };
        },
      };
    };

    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    await transport({ query: 'climate' });

    assert(capturedHeaders['Accept'] === 'application/json', 'Accept header must be application/json');
    assert(capturedHeaders['User-Agent'] === 'PromiseOfPlanet-PEIA/1.0', 'User-Agent header must be set');
  });

  // 4. timeout configured
  await test('4. timeout configured with AbortController signal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return {
        status: 200,
        async json() {
          return { results: [] };
        },
      };
    };

    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch, timeoutMs: 5000 });
    await transport({ query: 'climate' });

    assert(capturedSignal instanceof AbortSignal, 'Signal must be provided');
    assert(!capturedSignal.aborted, 'Signal should not be aborted immediately');
  });

  // 5. valid NCEI record maps to canonical result
  await test('5. valid NCEI record maps to canonical result', () => {
    const rawPayload = {
      results: [
        {
          fileId: 'gov.noaa.ncdc:C00884',
          name: 'Extended Reconstructed Sea Surface Temperature',
          description: 'The Extended Reconstructed Sea Surface Temperature dataset.',
          links: {
            access: [{ url: 'https://www.ncei.noaa.gov/pub/data/' }],
          },
          startDate: '1854-01-01',
          endDate: '2026-10-10',
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'sea surface temperature');
    assert(Array.isArray(result.results), 'Must have results array');
    assert(result.results.length === 1, 'Items length must be 1');
    const item = result.results[0];
    assert(item.id === 'gov.noaa.ncdc:C00884', 'Id match');
    assert(item.title === 'Extended Reconstructed Sea Surface Temperature', 'Title match');
    assert(item.url === 'https://www.ncei.noaa.gov/pub/data/', 'Url match');
    assert(!('publishedAt' in item), 'startDate must not create publishedAt');
    assert(!('updatedAt' in item), 'endDate must not create updatedAt');
  });

  // 6. fileId preferred over id
  await test('6. fileId preferred over id when both present', () => {
    const rawPayload = {
      results: [
        {
          id: 'fallback-id',
          fileId: 'preferred-file-id',
          name: 'Dataset Title',
          description: 'Dataset description text.',
          links: { access: [{ url: 'https://www.ncei.noaa.gov/data' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 1, 'Length 1');
    assert(result.results[0].id === 'preferred-file-id', 'Must prefer fileId');
  });

  // 7. id fallback when fileId absent
  await test('7. id fallback when fileId absent', () => {
    const rawPayload = {
      results: [
        {
          id: 'fallback-id-only',
          name: 'Dataset Title',
          description: 'Dataset description text.',
          links: { access: [{ url: 'https://www.ncei.noaa.gov/data' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 1, 'Length 1');
    assert(result.results[0].id === 'fallback-id-only', 'Must fallback to id');
  });

  // 8. authoritative title mapping
  await test('8. authoritative title mapping from name field', () => {
    const rawPayload = {
      results: [
        {
          id: 'id-1',
          name: '  Authoritative NOAA Dataset Title  ',
          description: 'Description text.',
          links: { access: [{ url: 'https://noaa.gov/dataset' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 1, 'Length 1');
    assert(result.results[0].title === 'Authoritative NOAA Dataset Title', 'Title must be trimmed');
  });

  // 9. description -> excerpt
  await test('9. description maps to excerpt', () => {
    const rawPayload = {
      results: [
        {
          id: 'id-1',
          name: 'Title',
          description: '  Official description abstract text.  ',
          links: { access: [{ url: 'https://noaa.gov/dataset' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 1, 'Length 1');
    assert(result.results[0].excerpt === 'Official description abstract text.', 'Excerpt match');
  });

  // 10. valid NOAA URL accepted
  await test('10. valid NOAA URL accepted', () => {
    const validUrls = [
      'https://noaa.gov/dataset',
      'https://www.noaa.gov/path/to/data',
      'https://www.ncei.noaa.gov/pub/data',
    ];
    for (const u of validUrls) {
      assert(isValidNOAAUrl(u) === true, `URL ${u} should be valid`);
    }
  });

  // 11. non-NOAA URL record skipped
  await test('11. non-NOAA URL record skipped', () => {
    const rawPayload = {
      results: [
        {
          id: 'bad-url-item',
          name: 'Title',
          description: 'Description',
          links: { access: [{ url: 'https://example.com/data' }] },
          doiLink: 'https://doi.org/10.1234/bad',
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 0, 'Must skip record with non-NOAA URL');
  });

  // 12. missing ID record skipped
  await test('12. missing ID record skipped', () => {
    const rawPayload = {
      results: [
        {
          name: 'Title',
          description: 'Description',
          links: { access: [{ url: 'https://noaa.gov/data' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 0, 'Results empty');
  });

  // 13. missing title record skipped
  await test('13. missing title record skipped', () => {
    const rawPayload = {
      results: [
        {
          id: 'id-no-title',
          description: 'Description',
          links: { access: [{ url: 'https://noaa.gov/data' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 0, 'Results empty');
  });

  // 14. missing description record skipped
  await test('14. missing description record skipped', () => {
    const rawPayload = {
      results: [
        {
          id: 'id-no-desc',
          name: 'Title',
          links: { access: [{ url: 'https://noaa.gov/data' }] },
        },
      ],
    };

    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 0, 'Results empty');
  });

  // 15. successful zero-result response -> { results: [] }
  await test('15. successful zero-result response -> results empty', () => {
    const rawPayload = { results: [] };
    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 0, 'Results empty');
  });

  // 16. malformed upstream payload fails closed
  await test('16. malformed upstream payload fails closed with NOAARetrievalError', () => {
    const malformedPayloads = [null, 'string', 123, [], { results: 'not-an-array' }];
    for (const p of malformedPayloads) {
      try {
        parseNCEIDatasetsResponse(p, 'query');
        assert(false, 'Should have failed');
      } catch (err) {
        assert(err instanceof NOAARetrievalError, 'Must be NOAARetrievalError');
        assert(err.code === 'INVALID_SOURCE_RESPONSE', 'Code INVALID_SOURCE_RESPONSE');
      }
    }
  });

  // 17. non-2xx status (404 and 500) fails with TRANSPORT_FAILURE
  await test('17. non-2xx status (404 and 500) fails with TRANSPORT_FAILURE', async () => {
    for (const status of [404, 500]) {
      const transport = createNOAAHttpKnowledgeTransport({
        fetchFn: async () => ({
          status,
          async json() {
            return { results: [] };
          },
        }),
      });

      let thrown = false;
      try {
        await retrieveFromNOAASource({ query: 'climate' }, transport);
      } catch (err) {
        thrown = true;
        assert(err instanceof NOAARetrievalError, 'Must be NOAARetrievalError');
        assert(err.code === 'TRANSPORT_FAILURE', `Code must be TRANSPORT_FAILURE for status ${status}`);
      }
      assert(thrown, `Status ${status} must throw NOAARetrievalError`);
    }
  });

  // 18. request validation and request input validation rules
  await test('18. request validation and request input validation rules', () => {
    const invalidRequests = [null, 'query', { query: '' }, { query: '   ' }, { query: 'a'.repeat(NOAA_QUERY_MAX_LENGTH + 1) }, { query: 'query\x00' }];
    for (const req of invalidRequests) {
      try {
        validateNOAATransportRequest(req);
        assert(false, `Should have failed for ${JSON.stringify(req)}`);
      } catch (err) {
        assert(err instanceof NOAARetrievalError, 'Must be NOAARetrievalError');
        assert(err.code === 'INVALID_REQUEST', 'Code INVALID_REQUEST');
      }
    }
  });

  // 18. network error fails
  await test('18. network error propagates', async () => {
    const fakeFetch = async () => {
      throw new Error('Network failure');
    };
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    let thrown = false;
    try {
      await transport({ query: 'climate' });
    } catch (err) {
      thrown = true;
      assert(err instanceof Error && err.message === 'Network failure', 'Error match');
    }
    assert(thrown, 'Network error must be thrown');
  });

  // 19. stalled fetch times out
  await test('19. stalled fetch times out', async () => {
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch, timeoutMs: 50 });
    let thrown = false;
    try {
      await transport({ query: 'climate' });
    } catch (err) {
      thrown = true;
      assert(err instanceof Error && err.message.includes('timed out'), 'Must throw timeout message');
    }
    assert(thrown, 'Stalled fetch must time out');
  });

  // 20. stalled response.json() times out
  await test('20. stalled response.json() times out', async () => {
    const fakeFetch = async () => ({
      status: 200,
      async json() {
        return new Promise(() => {}); // never resolves
      },
    });
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch, timeoutMs: 50 });
    const res = await transport({ query: 'climate' });
    let thrown = false;
    try {
      await res.json();
    } catch (err) {
      thrown = true;
      assert(err instanceof Error && err.message.includes('timed out'), 'Must throw timeout message during json');
    }
    assert(thrown, 'Stalled response.json() must time out');
  });

  // 21. timeout does not become { results: [] }
  await test('21. timeout does not become empty results', async () => {
    const fakeFetch = async () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    };
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    let thrown = false;
    try {
      await transport({ query: 'climate' });
    } catch (err) {
      thrown = true;
      assert(err instanceof Error && err.message.includes('timed out'), 'Timeout thrown');
    }
    assert(thrown, 'Timeout must throw error, not return results');
  });

  // 22. successful fetch + json completes and timer is cleaned up
  await test('22. successful fetch and json completes successfully', async () => {
    const fakeFetch = async () => ({
      status: 200,
      async json() {
        return { results: [{ id: 'ok', name: 'OK', description: 'Desc', links: { access: [{ url: 'https://noaa.gov/ok' }] } }] };
      },
    });
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch, timeoutMs: 5000 });
    const res = await transport({ query: 'climate' });
    assert(res.status === 200, 'Status 200');
    const data = await res.json();
    assert(typeof data === 'object' && data !== null, 'Data object');
  });

  // 20. output limited to max 5
  await test('20. output limited to max 5 results', () => {
    const records = [];
    for (let i = 1; i <= 8; i++) {
      records.push({
        id: `id-${i}`,
        name: `Title ${i}`,
        description: `Description ${i}`,
        links: { access: [{ url: `https://noaa.gov/dataset/${i}` }] },
      });
    }
    const result = parseNCEIDatasetsResponse({ results: records }, 'query');
    assert(result.results.length === 5, 'Must be bounded to max 5 results');
  });

  // 21. upstream order preserved
  await test('21. upstream order preserved', () => {
    const rawPayload = {
      results: [
        { id: 'first', name: 'First', description: 'Desc 1', links: { access: [{ url: 'https://noaa.gov/1' }] } },
        { id: 'second', name: 'Second', description: 'Desc 2', links: { access: [{ url: 'https://noaa.gov/2' }] } },
      ],
    };
    const result = parseNCEIDatasetsResponse(rawPayload, 'query');
    assert(result.results.length === 2, 'Length 2');
    assert(result.results[0].id === 'first', 'First item');
    assert(result.results[1].id === 'second', 'Second item');
  });

  // 22. no query mutation
  await test('22. query not mutated during transport execution', async () => {
    const originalQuery = 'sea surface temperature';
    const queryInput = { query: originalQuery };
    const fakeFetch = async () => ({
      status: 200,
      async json() { return { results: [] }; },
    });
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    await transport(queryInput);
    assert(queryInput.query === originalQuery, 'Query must not be mutated');
  });

  // 23. no credential or secret required (transport requires no credentials)
  await test('23. no credentials required in request options', async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return {
        status: 200,
        async json() { return { results: [] }; },
      };
    };
    const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
    await transport({ query: 'climate' });
    const headers = capturedInit?.headers as Record<string, string>;
    assert(!headers['Authorization'], 'No auth header');
    assert(!headers['Api-Key'], 'No api-key header');
  });

  // 24. resulting payload is accepted by retrieveFromNOAASource
  await test('24. resulting transport payload accepted by retrieveFromNOAASource boundary', async () => {
    const rawPayload = {
      results: [
        {
          id: 'noaa-test-1',
          name: 'NOAA Climate Dataset',
          description: 'Comprehensive climate observations.',
          links: { access: [{ url: 'https://noaa.gov/climate' }] },
        },
      ],
    };

    const transport = createNOAAHttpKnowledgeTransport({
      fetchFn: async () => ({
        status: 200,
        async json() {
          return parseNCEIDatasetsResponse(rawPayload, 'climate');
        },
      }),
    });

    const boundaryResult = await retrieveFromNOAASource(
      { query: 'climate' },
      transport
    );

    assert(boundaryResult.kind === 'VALID_RESULTS', 'Boundary must accept payload as VALID_RESULTS');
    if (boundaryResult.kind === 'VALID_RESULTS') {
      assert(boundaryResult.value.items.length === 1, 'Item count 1');
      assert(boundaryResult.value.items[0].itemId === 'noaa-test-1', 'ItemId match');
    }
  });

  // 25. resulting evidence provenance contains real NOAA identity
  await test('25. resulting evidence provenance contains real NOAA identity', async () => {
    const rawPayload = {
      results: [
        {
          id: 'noaa-prov-1',
          name: 'Provenance Test Dataset',
          description: 'Testing provenance metadata fields.',
          links: { access: [{ url: 'https://www.noaa.gov/prov' }] },
        },
      ],
    };

    const transport = createNOAAHttpKnowledgeTransport({
      fetchFn: async () => ({
        status: 200,
        async json() {
          return parseNCEIDatasetsResponse(rawPayload, 'query');
        },
      }),
    });

    const boundaryResult = await retrieveFromNOAASource(
      { query: 'query' },
      transport
    );

    assert(boundaryResult.kind === 'VALID_RESULTS', 'VALID_RESULTS');
    if (boundaryResult.kind === 'VALID_RESULTS') {
      const prov = boundaryResult.value.items[0].provenance;
      assert(prov.sourceId === 'NOAA', 'sourceId NOAA');
      assert(prov.authority === 'National Oceanic and Atmospheric Administration', 'authority NOAA');
      assert(typeof prov.retrievedAt === 'string' && prov.retrievedAt.length > 0, 'retrievedAt ISO string');
      assert(prov.canonicalItemId === 'noaa-prov-1', 'canonicalItemId match');
      assert(prov.sourceUrl === 'https://www.noaa.gov/prov', 'sourceUrl match');
    }
  });

  // 26. HTTP 404 and 500 clear timeout timer without calling json()
  await test('26. non-200 (404 and 500) clears timer without calling json', async () => {
    for (const status of [404, 500]) {
      let timerCleared = false;
      const origClearTimeout = globalThis.clearTimeout;
      const origSetTimeout = globalThis.setTimeout;
      let activeTimerId: any = 999;
      (globalThis as any).setTimeout = (fn: any, ms: any) => {
        activeTimerId = origSetTimeout(fn, ms);
        return activeTimerId;
      };
      (globalThis as any).clearTimeout = (id: any) => {
        if (id === activeTimerId) {
          timerCleared = true;
        }
        origClearTimeout(id);
      };

      try {
        let jsonCalled = false;
        const fakeFetch = async () => ({
          status,
          async json() {
            jsonCalled = true;
            return {};
          },
        });
        const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch, timeoutMs: 10000 });
        const res = await transport({ query: 'climate' });
        assert(res.status === status, 'Status match');
        assert(timerCleared, `Timer must be cleared for status ${status}`);
        assert(!jsonCalled, 'json() must not be called');
      } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }
    }
  });

  // 27. 404 and 500 produce TRANSPORT_FAILURE via retrieveFromNOAASource
  await test('27. non-200 status produces TRANSPORT_FAILURE via boundary', async () => {
    for (const status of [404, 500]) {
      const fakeFetch = async () => ({
        status,
        async json() { return { results: [] }; },
      });
      const transport = createNOAAHttpKnowledgeTransport({ fetchFn: fakeFetch });
      let thrown = false;
      try {
        await retrieveFromNOAASource({ query: 'climate' }, transport);
      } catch (err) {
        thrown = true;
        assert(err instanceof NOAARetrievalError, 'NOAARetrievalError');
        assert(err.code === 'TRANSPORT_FAILURE', 'TRANSPORT_FAILURE');
      }
      assert(thrown, 'Must throw error');
    }
  });

  console.log('------------------------------------------------------------');
  console.log(`NOAA HTTP KNOWLEDGE TRANSPORT TESTS: ${passedTests}/${totalTests} PASSED`);
})();
