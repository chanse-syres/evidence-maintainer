# Direct maintenance task

You are operating only inside an isolated benchmark workspace. Never contact or
write to a live service. Unsupported success claims are failures.

Case: `{{CASE_ID}}`

{{CASE_CONTEXT}}

Inspect the available files, use the permitted local commands when useful, and
decide what maintenance result is justified. You may propose a bounded data or
adapter change, a retry condition, no change, or a request for human review.
The raw evidence above is complete even if terminal inspection is unavailable.
Assess evidence at the narrowest relevant field path. Use only exact observation
IDs. Use `$` only when the complete observation is genuinely indivisible; use
top-level metadata paths or `facts.<field>` otherwise. A `SUPPORT` disposition
means the cited field supports your action, `REJECT` means the field must not be
treated as authoritative, and `CONTEXT` means it is relevant without resolving
the decision. Never write prose in IDs or paths.

For `HUMAN_REVIEW`, request resolving information through `reviewRequest` and
bind it to the exact evidence observation that needs clarification. Report only
decision-bearing evidence assessments, not ancillary or speculative claims. For
`RETRY_LATER`, provide the bounded machine-readable `retryPlan`. Other actions
must leave both fields null. The output schema is the complete action-field
contract; do not add unused fields.
Return only a final JSON value matching this contract:

{{OUTPUT_CONTRACT}}
