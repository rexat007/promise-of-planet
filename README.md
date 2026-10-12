# Promise of Planet & PEIA V1

**Promise of Planet** is an advanced environmental monitoring, intelligence, and advisory platform featuring the **Planet Earth Intelligence Agency (PEIA V1)** local analysis and advisory pipeline.

## Overview

PEIA V1 is a robust local intelligence pipeline that ingests environmental evidence (such as real NOAA datasets), executes Qwen local model audits with Qwen thinking-suppression prompt instructions (`/no_think`), processes structured audit outputs into canonical `PEIAAdvisoryResult` objects, persists records locally (outbox / server sync), and executes comprehensive end-to-end acceptance tests.

PEIA is strictly advisory-only. AI cannot autonomously publish, approve, or reject records; human review and authority remain mandatory where applicable. Advisory and durable non-advisory outcomes represent separate valid paths.

## Key Capabilities

- **PEIA Local Analysis Runtime**: Local model invocation utilizing Qwen thinking-suppression prompt instructions (`/no_think`) to suppress extended thinking and request immediate raw JSON.
- **Advisory Result & Outbox Pipeline**: Automated transformation of model audits into persistent advisory results, local outbox staging, and resilient synchronization cycles.
- **Full E2E Runtime & Acceptance**: Automated orchestration harnesses verifying real NOAA retrieval, Qwen SHA verification, local model execution, non-advisory reporting, and replay verification.
- **Rigorous Testing**: Comprehensive unit and integration test suites (`runPEIALocalAnalysisRuntimeTests.ts`, `runPEIALocalTaskProcessingOrchestratorTests.ts`, `runPEIAFinalRealE2EAcceptance.ts`).

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation & Development

```bash
npm install
npm run dev
```

### Building

```bash
npm run build
```

### Type Checking
```bash
npm --prefix peia-worker run typecheck
```

### Running PEIA Test Suites

```bash
npx tsx scripts/runPEIALocalAnalysisRuntimeTests.ts
npx tsx scripts/runPEIALocalTaskProcessingOrchestratorTests.ts
npx tsx scripts/runPEIAFinalRealE2EAcceptance.ts
```
