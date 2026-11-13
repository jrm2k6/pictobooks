---
status: accepted
---

# Keep pipeline orchestration behind infrastructure-neutral ports

## Decision

The local pipeline needed to remain usable while adding Cloudflare storage and execution. We decided that pipeline orchestration depends on narrow ports, with filesystem and Cloudflare implementations supplied as adapters, so domain behavior can be exercised independently of its runtime.

## Result

The per-page generation path now runs through the infrastructure-neutral
`runPagePipeline` Module. It owns the generation sequence and depends only on
small Interfaces for normalization, candidate generation and processing,
artifact storage, metadata persistence, operation claims, time, IDs, and the
vision provider.

The existing local runner is the first composition root. Its filesystem,
Sharp, and provider-output-directory behavior lives in local Adapters, so the
CLI and artifact layout remain compatible. Cloudflare and S3 SDKs are not
imported by the domain Module.

## Interfaces and Adapters

| Interface              | Local Adapter                                                 |
| ---------------------- | ------------------------------------------------------------- |
| `ArtifactStore`        | JSON/text files beneath a photo directory                     |
| `MetadataRepository`   | Existing named JSON artifacts                                 |
| `PhotoNormalizer`      | Local copy plus Sharp PNG normalization                       |
| `CandidateGenerator`   | Existing configured image provider and candidate directory    |
| `CandidateProcessor`   | Existing cleanup and print-fitness stages                     |
| `OperationClaims`      | Completed-operation JSON records; in-memory Adapter for tests |
| `Clock`                | System UTC clock                                              |
| `IdGenerator`          | Deterministic request and operation IDs                       |
| vision/image providers | Existing mock and Gemini provider Adapters                    |

Operation claims are intentionally scoped to completed-operation replay in
WP1. Transactional distributed claims and state-transition constraints belong
to WP2's D1 schema and migrations.

## Preserved invariants

- A rejected intake is terminal for that page and does not invoke generation.
- Replaying a completed generation operation returns its recorded candidate
  set and cannot create a second set.
- Automatic repair terminates at its configured round budget or when
  improvement is below the configured minimum.
- Initial generation and automatic repair both use
  `selectGenerationStyleReferences`.

## Verification

- Pipeline TypeScript check and complete test suite pass.
- Tests cover rejected intake, generation-reference selection, duplicate
  operation replay, maximum repair rounds, and stalled repair improvement.
- The domain Module contains no Node filesystem, Cloudflare, AWS, R2, D1, or
  provider SDK import.
