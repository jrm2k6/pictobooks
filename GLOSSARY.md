# Pictobook Pipeline Language

Terms used to describe how Pictobook turns source photos into approved coloring-book pages.

## Language

**Book Run**:
A traceable attempt to transform one ordered set of source photos into coloring-book page candidates.
_Avoid_: Batch, session

**Source Photo**:
The customer-provided image from which a coloring-book page may be created.
_Avoid_: Input image, original

**Page Brief**:
The source-derived description of what a coloring-book page should depict and what it should simplify or omit.
_Avoid_: Prompt, scene prompt

**Candidate**:
One generated coloring-page option for a source photo.
_Avoid_: Image, output, result

**Print QA**:
The objective gate that evaluates whether a candidate is printable black-and-white coloring art.
_Avoid_: Original QA, technical QA

**Style QA**:
The visual gate that evaluates a candidate against the style bible, Page Brief, and Canonical References.
_Avoid_: Judge evaluation, visual judge

**Canonical Reference**:
A human-approved page intentionally selected to define the visual grammar of the house style.
_Avoid_: Approved page, example image

**Repair Round**:
One bounded semantic correction attempt that generates new candidates from Style QA findings.
_Avoid_: Retry, rerun

**Infrastructure Retry**:
A repeated provider request caused by a transient operational failure, without changing the creative instructions.
_Avoid_: Repair, regeneration

**Source Regeneration**:
A fresh generation attempt based on the Source Photo and accumulated QA findings, without using a failed candidate as a visual reference.
_Avoid_: Repair

**Human Review**:
An explicit reviewer decision for a page that automation cannot approve, or an optional confirmation used before Canonical Reference promotion.
_Avoid_: Manual QA

**Automated Approval**:
The terminal acceptance of an exact Candidate after that same Candidate passes both Print QA and Style QA.
_Avoid_: Ready, auto-ready

**Artifact**:
A versioned pipeline file stored durably in R2, such as a Source Photo, Candidate, QA result, Canonical Reference, or final export. D1 stores its metadata and object key.
_Avoid_: Blob record, local file

**Operation ID**:
A stable identifier used to claim and replay one pipeline side effect without duplicating an artifact, Candidate, or provider charge.
_Avoid_: Request ID, retry ID

**Operation Claim**:
The durable record that reserves one Operation ID and retains its outcome for safe replay.
_Avoid_: Lock, job record

**AI-Powered Workflow**:
The bounded Pictobook state machine that invokes generative and evaluative models while application code controls allowed actions, budgets, and terminal states.
_Avoid_: AI agent
