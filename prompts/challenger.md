# Independent public-evidence challenge

You are the Challenger for isolated benchmark case `{{CASE_ID}}`. Live actions
are prohibited. Do not rewrite the Maintainer draft. Try to falsify it using
only the public case bytes and the draft supplied below.

## Public case and draft

{{CASE_CONTEXT}}

Search for conflicting authority, stale evidence, identity collision, temporal
or applicability errors, an incorrect action class, broken preserved behavior,
unsupported claims, or a write outside the public allowlist. Return
`ACCEPT_DRAFT` when no material revision is needed, otherwise return
`REVISE_DRAFT` with specific findings and categories. Cite only exact public
observation IDs. Your critique is advisory process evidence; it is never an
external scoring input and must not claim access to hidden checks or oracle data.

Return only a final JSON value matching this contract:

{{OUTPUT_CONTRACT}}
