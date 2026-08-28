# Evidence Maintainer Specification Self-Review

Status: `READY_FOR_USER_REVIEW`

## Rubric Coverage

| Criterion | Design coverage | Remaining proof required |
|---|---|---|
| Problem and User Value | Named maintainer persona, production-derived bottleneck, concrete unsafe outcomes | Quantify historical human time and preventable-error cost |
| Agent Solution and Engineering | Two bounded roles, structured action routing, deterministic tools and gate, sandboxed coding repair | Implement and demonstrate that each role improves the same case suite |
| End-to-End Quality | Evidence intake through approval, diff, and standalone proof report | Finish the control room and record one realistic complete execution |
| Measured Improvement | Fair direct-agent baseline, Safe Decision Rate, 15 designed cases, repeated trials | Freeze cases and publish complete baseline/advanced results |
| Reproducibility | Frozen fixtures, native and offline paths, hashes, trajectories, exact command contract | Verify from a clean clone or container |
| Hot Take and Insights | Abstention and proposal/challenge separation tied to observed failures | Support the insight with the final experiment table |

## Scope Review

The design is ambitious but achievable in three days only if the protected core is enforced. Twelve complete cases are superior to fifteen incomplete cases. Adapter repair is limited to frozen fixtures and a bounded repository surface. Live production mutation, general web crawling, model training, and broad provider support remain out of scope.

## Novelty Review

The original ProofPatch direction collided with existing patch-verification tools and recent hackathon work. The revised design is materially different: it maintains an evolving source of truth and chooses among data update, adapter repair, retry, no-action, and human-review outcomes. Code repair is one branch of the decision system rather than the product itself.

## Integrity Review

The spec now separates pre-existing Beaver Front Office assets from competition work, requires fixture-level provenance, excludes private task bytes and credentials, and labels recorded offline evidence separately from live agent execution.

## Default Implementation Decisions After Approval

- Build 12 core cases first; add three only after the core reproduces cleanly.
- Use TypeScript and the local Codex CLI JSONL interface.
- Use a small polished local web control room rather than extending the live OSU application.
- Keep all competition actions inside isolated case workspaces.
- Run the same model and case versions for baseline and advanced comparisons.
- Preserve every trial and publish failures rather than selecting favorable runs.

## Remaining Risks

1. Live-agent authentication or quota could interrupt evaluation. Mitigation: capture early, retain deterministic replay, and disclose recorded versus live modes.
2. A source fixture may have unclear reuse rights. Mitigation: replace it with a structurally equivalent synthetic fixture and retain only public citations.
3. The advanced workflow may be slower or more expensive. Mitigation: report the tradeoff and optimize Safe Decision Rate per dollar as a supporting metric.
4. The control room could consume too much time. Mitigation: favor one polished decision flow over broad navigation.
5. The baseline may be perceived as weak. Mitigation: use the same capable model, repository tools, output contract, and wall-clock limit; withhold only the advanced workflow structure.

