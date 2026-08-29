# Historical Product Specification

This file marks the boundary between the original challenge concept and the current evaluation system.

The original specification proposed an evidence-grounded public-data maintainer with five dispositions: update canonical data, repair an adapter, retry later, take no action, or request human review. It also proposed a direct-agent baseline, an adversarial review step, frozen cases, isolated execution, provenance hashes, and complete run retention.

That early evaluation contract is retired. Its evaluator coupled operational correctness to exact annotation choices and later used asymmetric challenge paths across arms. V1, V2, and V3 cannot support public performance claims.

The governing V4 contract now requires:

- one final `DecisionPackage` schema for both arms;
- one shared finalizer and semantic evaluator;
- an advisory Challenger followed by an explicit Reviser in the advanced workflow;
- Operational Decision Integrity based on six blocking semantic and execution checks;
- explicit authority-validity rules and satisfiable future-evidence selectors;
- typed model, infrastructure, evaluator, and genuine semantic failure ownership;
- symmetric exclusion of evaluator-invalid cases;
- case-balanced repeated-trial analysis;
- no selected public comparison until a valid V4 campaign completes.

See [Evaluation contract and evidence status](evaluation.md), [Architecture and trust boundaries](architecture.md), and [`config/public-comparison.json`](../config/public-comparison.json).
