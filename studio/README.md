# Abada Studio

Visual workflow designer for the Abada BPMN orchestration platform.

## Overview

Abada Studio is a React-based authoring environment for building, editing, and deploying BPMN process definitions. It supports:

- **Visual flow editing** with drag-and-drop nodes and auto-layout
- **APL (Abada Process Language)** — a native YAML DSL that compiles to BPMN 2.0
- **BPMN round-trip** — import existing BPMN files, edit visually, export back to BPMN
- **Form binding** — attach Camunda forms to user tasks
- **Decision tables** — model DMN rules inline
- **Agent tasks** — configure AI agent executions with profiles, models, and tools

## Technology Stack

- React 19.2 + TypeScript 6
- Vite 8
- Tailwind CSS 4
- React Flow (@xyflow/react) for the canvas
- fast-xml-parser for BPMN XML handling

## Development

```bash
# Install dependencies
npm ci

# Start the dev server
npm run dev

# Run the linter
npm run lint

# Run tests
npm run test

# Build for production
npm run build
```

The build includes a kitchen-sink round-trip test that verifies APL → BPMN → APL correctness.

## Project Structure

```
src/
  components/          # React UI components (canvas, sidebar, inspectors)
  features/           # Domain features (DMN inspector)
  lib/
    apl/              # APL parser and type system
    bpmn/             # BPMN compiler (APL → BPMN) and transpiler (BPMN → APL)
    autoLayout.ts     # Dagre-based node layout
  types.ts            # Studio domain types
```

## Versioning

This package is version-locked with the Abada Engine. See the root `engine/pom.xml` for the canonical version.
