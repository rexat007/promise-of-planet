# Promise of Planet — Project Setup & Architecture

## Overview

**Promise of Planet** is built with a modern web frontend (React, TypeScript, Vite, Tailwind CSS) integrated with the **Planet Earth Intelligence Agency (PEIA V1)** backend and local analysis runtime worker (`peia-worker`).

PEIA V1 operates with local Windows Qwen execution, local SQLite persistence, real NOAA retrieval, advisory-only behavior, and mandatory human authority (no autonomous publish/approve/reject).

## Technical Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS.
- **PEIA Worker (`peia-worker`)**: Local analysis runtime, model prompt builder with Qwen thinking suppression (`/no_think`), task processing orchestrator, advisory result generators, and local SQLite outbox persistence.
- **Test Harnesses**: Dedicated TypeScript test suites for runtime analysis, task orchestration, and E2E acceptance verification.

## Development & Verification Commands

### Install Dependencies
```bash
npm install
```

### Run Frontend Development Server
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

### Worker TypeScript Type Checking
```bash
npm --prefix peia-worker run typecheck
```

### PEIA Test Execution
```bash
npx tsx scripts/runPEIALocalAnalysisRuntimeTests.ts
npx tsx scripts/runPEIALocalTaskProcessingOrchestratorTests.ts
npx tsx scripts/runPEIAFinalRealE2EAcceptance.ts
```

## Repository Status

PEIA V1 has been fully implemented, tested, and accepted with `ACCEPTANCE_PASSED` status across all units (advisory-only, human authority preserved).
