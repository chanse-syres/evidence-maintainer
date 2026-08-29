# Historical Specification Review

The original pre-implementation rubric review is retired because it evaluated the V1 design, not the current V4 system. Its targets were planning goals, not achieved results.

The useful conclusions that survived audit are narrow:

- both arms need identical agent-visible case bytes and one external scoring boundary;
- recorded fixtures prove harness behavior, not model performance;
- every failure and invalidation needs retained evidence;
- resource cost must be reported alongside correctness;
- a comparison must be able to show no improvement or a negative result.

The current repository publishes one adjudicated V4 comparison: 12/12 ODI in both arms across four included cases, with one case excluded symmetrically as evaluator-invalid. See [Evaluation contract and evidence status](evaluation.md) and [Improvement and invalidation changelog](improvement-changelog.md).
