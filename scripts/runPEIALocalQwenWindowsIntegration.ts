import {
  AITaskType,
  AITaskStatus,
  type AIReviewTask,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
} from '../src/types/aiReview';
import {
  EPA_SOURCE_ID,
  EPA_AUTHORITY,
  type EPAEvidenceItem,
} from '../peia-worker/src/epaKnowledgeRetrievalBoundary';
import {
  NOAA_SOURCE_ID,
  NOAA_AUTHORITY,
  type NOAAEvidenceItem,
} from '../peia-worker/src/noaaKnowledgeRetrievalBoundary';
import {
  type SelectedEvidenceResult,
  type SelectedEvidenceItem,
} from '../peia-worker/src/localEvidenceSelectionFoundation';
import {
  analyzeTaskLocally,
  type LocalAnalysisRuntimeConfig,
  type LocalAnalysisResult,
} from '../peia-worker/src/localAnalysisRuntime';

function parseCliArgs(): { llamaCliPath: string; modelPath: string } {
  let llamaCliPath = process.env.PEIA_LLAMA_CLI_PATH || 'llama-cli';
  let modelPath =
    process.env.PEIA_MODEL_PATH || 'C:\\PEIA\\models\\Qwen3-4B-Q4_K_M.gguf';

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--llama-cli' && i + 1 < args.length) {
      llamaCliPath = args[i + 1];
      i++;
    } else if (args[i] === '--model' && i + 1 < args.length) {
      modelPath = args[i + 1];
      i++;
    }
  }

  return { llamaCliPath, modelPath };
}

async function runWindowsIntegration() {
  console.log('=== PEIA REAL WINDOWS QWEN INTEGRATION HARNESS ===');
  const { llamaCliPath, modelPath } = parseCliArgs();

  console.log(`Configured llama-cli: "${llamaCliPath}"`);
  console.log(`Configured model path: "${modelPath}"`);

  const sampleTask: AIReviewTask = {
    taskId: 'task-real-windows-audit-001',
    taskType: AITaskType.CONTENT_REVIEW,
    status: AITaskStatus.Pending,
    createdAt: '2026-10-05T00:00:00.000Z',
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-coastal-water-2026',
      sourceUpdatedAt: '2026-10-04T18:00:00.000Z',
    },
    contentSnapshot: {
      title: 'Municipal Water Quality and Coastal Estuary Assessment',
      claims: [
        'Runoff from municipal discharges has altered nutrient levels in coastal zones.',
        'Sea surface temperature anomalies have been tracked along the estuary.',
      ],
      location: 'Atlantic Coastal Estuary',
    },
  };

  const sampleEPAItem: EPAEvidenceItem = {
    itemId: 'epa-cwa-402-guidelines',
    sourceId: EPA_SOURCE_ID,
    authority: EPA_AUTHORITY,
    title: 'Clean Water Act Section 402 Municipal Separate Storm Sewer Guidance',
    excerpt:
      'Municipal storm sewer runoff requires monitoring for phosphorus and nitrogen loadings to prevent estuary eutrophication.',
    sourceUrl: 'https://www.epa.gov/npdes/stormwater-discharges-municipal-sources',
    provenance: {
      sourceId: EPA_SOURCE_ID,
      authority: EPA_AUTHORITY,
      retrievedAt: '2026-10-05T01:00:00.000Z',
      sourceUrl: 'https://www.epa.gov/npdes/stormwater-discharges-municipal-sources',
      canonicalItemId: 'epa-cwa-402-guidelines',
    },
  };

  const sampleNOAAItem: NOAAEvidenceItem = {
    itemId: 'noaa-buoy-sst-anomaly-2026',
    sourceId: NOAA_SOURCE_ID,
    authority: NOAA_AUTHORITY,
    title: 'NOAA National Data Buoy Center Estuarine SST Observation',
    excerpt:
      'Surface temperature anomalies recorded across coastal observation buoys showed a 0.8C deviation during late summer.',
    sourceUrl: 'https://www.noaa.gov/ocean/estuary-sst-records',
    provenance: {
      sourceId: NOAA_SOURCE_ID,
      authority: NOAA_AUTHORITY,
      retrievedAt: '2026-10-05T01:05:00.000Z',
      sourceUrl: 'https://www.noaa.gov/ocean/estuary-sst-records',
      canonicalItemId: 'noaa-buoy-sst-anomaly-2026',
    },
  };

  const selectedItems: SelectedEvidenceItem[] = [
    {
      sourceId: 'EPA',
      itemId: sampleEPAItem.itemId,
      authority: sampleEPAItem.authority,
      title: sampleEPAItem.title,
      excerpt: sampleEPAItem.excerpt,
      sourceUrl: sampleEPAItem.sourceUrl,
      provenance: sampleEPAItem.provenance,
      originalSourceOrder: 0,
      originalItemOrder: 0,
    },
    {
      sourceId: 'NOAA',
      itemId: sampleNOAAItem.itemId,
      authority: sampleNOAAItem.authority,
      title: sampleNOAAItem.title,
      excerpt: sampleNOAAItem.excerpt,
      sourceUrl: sampleNOAAItem.sourceUrl,
      provenance: sampleNOAAItem.provenance,
      originalSourceOrder: 1,
      originalItemOrder: 0,
    },
  ];

  const evidenceResult: SelectedEvidenceResult = {
    kind: 'SELECTED_EVIDENCE',
    query: 'municipal runoff and coastal sea surface temperature',
    selectedItems,
    totalEligibleItems: 2,
    truncated: false,
  };

  const config: LocalAnalysisRuntimeConfig = {
    llamaCliPath,
    modelPath,
    contextSize: 4096,
    temperature: 0.1,
    maxTokens: 1024,
    maxContextChars: 8000,
  };

  console.log('Invoking local analysis runtime...');
  let result: LocalAnalysisResult;
  try {
    result = await analyzeTaskLocally(sampleTask, evidenceResult, config);
  } catch (err: unknown) {
    console.error('Fatal unhandled runtime exception:');
    console.error(err);
    process.exit(1);
  }

  console.log('\n--- SANITIZED LOCAL ANALYSIS RESULT (JSON) ---');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n--- LOCAL ANALYSIS SUMMARY ---');
  console.log(`Outcome kind: ${result.kind}`);
  console.log(`Human review required: ${result.humanReviewRequired}`);

  if (result.kind === 'ADVISORY_READY') {
    console.log(`Summary: ${result.advisory.summary}`);
    console.log(`Findings count: ${result.advisory.findings.length}`);
    console.log(`Cited evidence IDs: [${result.usedEvidenceIds.join(', ')}]`);
    console.log(`Recommendations count: ${result.advisory.recommendations.length}`);
    console.log(`Uncertainties count: ${result.advisory.uncertainties.length}`);
  } else if (result.kind === 'ABSTAINED') {
    console.log(`Abstain reason: ${result.reason}`);
    console.log(`Detail: ${result.detail}`);
    console.log(`Limitations: ${result.limitations.join('; ')}`);
  } else if (result.kind === 'MODEL_FAILURE') {
    console.log(`Failure code: ${result.code}`);
    console.log(`Message: ${result.message}`);
    console.log(`Exit code: ${result.exitCode ?? 'none'}`);
  }

  if (result.modelTrace !== undefined) {
    console.log('\n--- MODEL TRACE METRICS ---');
    console.log(`Model identifier: ${result.modelTrace.modelName}`);
    console.log(`Effective ngl: ${result.modelTrace.ngl}`);
    console.log(`Context size: ${result.modelTrace.contextSize}`);
    console.log(`Temperature: ${result.modelTrace.temperature}`);
    console.log(`Max tokens: ${result.modelTrace.maxTokens}`);
    console.log(`Timeout: ${result.modelTrace.timeoutMs} ms`);
    console.log(`CPU threads: ${result.modelTrace.cpuThreads ?? 'default'}`);
    console.log(`Prompt length: ${result.modelTrace.promptChars} chars`);
    console.log(`Duration: ${result.modelTrace.executionDurationMs} ms`);
    console.log(`Context supplied: ${result.modelTrace.contextItemsSupplied}`);
    console.log(`Context retained: ${result.modelTrace.contextItemsRetained}`);
    console.log(`Context excluded: ${result.modelTrace.contextItemsExcluded}`);
    console.log(`Output length: ${result.modelTrace.modelOutputChars} chars`);
  }

  // Positive integration verification
  if (result.kind === 'ABSTAINED') {
    console.error(`\n[POSITIVE INTEGRATION FAILURE] Expected ADVISORY_READY, but model abstained.`);
    console.error(`Abstain reason: ${result.reason}`);
    console.error(`Detail: ${result.detail}`);
    process.exit(1);
  }

  if (result.kind === 'MODEL_FAILURE') {
    console.error(`\n[POSITIVE INTEGRATION FAILURE] Expected ADVISORY_READY, but model execution failed.`);
    console.error(`Failure code: ${result.code}`);
    console.error(`Message: ${result.message}`);
    console.error(`Exit code: ${result.exitCode ?? 'none'}`);
    process.exit(2);
  }

  if (result.humanReviewRequired !== true) {
    console.error('\n[POSITIVE INTEGRATION FAILURE] Violated contract: humanReviewRequired must always be true');
    process.exit(3);
  }

  if (!result.advisory.findings || result.advisory.findings.length === 0) {
    console.error('\n[POSITIVE INTEGRATION FAILURE] Violated contract: ADVISORY_READY must contain at least one finding');
    process.exit(4);
  }

  const sampleRetainedRefs = new Set(
    selectedItems.map((item) => `${item.sourceId}::${item.itemId}`)
  );

  for (let i = 0; i < result.advisory.findings.length; i++) {
    const f = result.advisory.findings[i];
    if (!f.evidenceIds || f.evidenceIds.length === 0) {
      console.error(`\n[POSITIVE INTEGRATION FAILURE] Finding at index ${i} has empty evidence citations`);
      process.exit(5);
    }
    for (const eid of f.evidenceIds) {
      if (!sampleRetainedRefs.has(eid)) {
        console.error(
          `\n[POSITIVE INTEGRATION FAILURE] Finding at index ${i} cites evidence ID "${eid}" outside sample retained set`
        );
        process.exit(6);
      }
    }
  }

  console.log('\nPositive real-Qwen Windows integration harness check completed successfully.');
}

if (process.argv[1]?.includes('runPEIALocalQwenWindowsIntegration')) {
  runWindowsIntegration().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
