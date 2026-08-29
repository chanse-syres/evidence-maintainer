# Direct maintenance task

You are operating only inside an isolated benchmark workspace. Never contact or
write to a live service. Unsupported success claims are failures.

Case: `{{CASE_ID}}`

{{CASE_CONTEXT}}

Inspect the available files, use the permitted local commands when useful, and
decide what maintenance result is justified. You may propose a bounded data or
adapter change, a retry condition, no change, or a request for human review.
The raw evidence above is complete even if terminal inspection is unavailable.
In `evidenceUsed` and `evidenceRejected`, cite only exact observation IDs or
agent-visible file paths from the case context; never write prose citations.
Return only a final JSON value matching this contract:

{{OUTPUT_CONTRACT}}
