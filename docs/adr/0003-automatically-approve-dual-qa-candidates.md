---
status: accepted
---

# Automatically approve Candidates that pass both QA gates

When the same Candidate passes Print QA and Style QA, its Page moves directly
to `approved`; it does not wait in a separate `ready` state for Human Review.
The Page records the exact Candidate and whether approval was automatic or
human. Human Review remains available for exceptions that automation sends to
`needs_human_review`, and Canonical Reference promotion still requires an
explicit approved Review because joining the house-style catalogue is a
separate, higher-impact decision.

This amends the acceptance terminology in ADR 0001 and ADR 0002. It removes a
mandatory review bottleneck for Candidates that already satisfy both gates
while retaining traceability and explicit human control over style-catalogue
growth.
