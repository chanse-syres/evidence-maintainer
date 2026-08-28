# Evidence Maintainer Agent Instructions

This repository is a standalone hackathon submission. It must never write to a
live public-data product, Project Dynamo repository, or external service.

- Keep all model actions inside copied case workspaces.
- Treat case evidence as immutable and oracle files as evaluator-only.
- Preserve explicit `live` versus `recorded` truth labels in every artifact.
- Use the same case bytes, model, schema, and timeout for baseline comparisons.
- Require deterministic gate success and simulated approval before applying a
  consequential candidate change.
- Never add credentials, private task bytes, private account data, or proprietary
  trajectories.
- Use test-first development and keep the normal `main` branch name.
