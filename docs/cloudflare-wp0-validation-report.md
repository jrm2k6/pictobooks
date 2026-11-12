# WP0 Cloudflare Platform Validation Report

Validation date: 2026-11-07

## Decision

**Go for the Cloudflare platform architecture.**

The architecture works locally and on Cloudflare across Worker, D1, R2, Workflow, Durable Objects, Containers, Node 22, and `sharp` 0.35.5. Hosted processing, cold Container startup, R2/D1 persistence, output checksums, and idempotent replay passed against dedicated development resources.

Proceed to WP1. The POC validates the platform boundary, not the complete generation pipeline or production security posture.

## What was validated

| Capability                | Result | Evidence                                                                                                                                       |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare authentication | Passed | Wrangler and `cf` both authenticated to the intended account with D1, R2, Workers, and Containers scopes.                                      |
| Local D1                  | Passed | Migration applied to persisted local state; run, operation, and artifact records written.                                                      |
| Remote D1                 | Passed | Development database created in WNAM and migration `0001_spike.sql` applied remotely.                                                          |
| Local R2                  | Passed | Source and normalized PNG stored through the Worker binding.                                                                                   |
| Remote R2                 | Passed | Development bucket created in WNAM; uploaded object checksum matched after download.                                                           |
| Local Workflow            | Passed | One Workflow instance durably executed claim and normalization steps.                                                                          |
| Idempotent API replay     | Passed | Reposting `run-001` returned `created: false`; counts remained one run, one operation, one artifact.                                           |
| Node 22 + Sharp Container | Passed | Docker image built locally and in Cloudflare's registry; both runtimes normalized an image.                                                    |
| Remote Container          | Passed | A `lite` Container started through a per-run Durable Object, passed readiness, processed the source, and scaled back to zero active instances. |
| Worker deployment         | Passed | Development Worker, Workflow, Durable Object export, Container image, D1, and R2 bindings deployed together.                                   |
| Hosted idempotent replay  | Passed | Reposting `hosted-run-001` returned `created: false`; remote counts remained one run, one operation, one artifact.                             |
| Hosted restart recovery   | Passed | `hosted-run-002` completed from the same R2 source after Cloudflare reported zero active Container instances.                                  |

## End-to-end local result

```text
PUT Source Photo
  -> local R2 source object
  -> D1 source record
POST Book Run
  -> local Workflow instance
  -> D1 operation claim
  -> source streamed from R2 to Dockerized Node/Sharp service
  -> normalized PNG returned
  -> local R2 output object
  -> D1 artifact, operation, and completed run state
```

The representative run completed with:

- source: `4,205,043` bytes;
- normalized PNG: `16,091,491` bytes;
- normalization wall time on the development machine: approximately `0.83s`;
- running Container memory observed after the test: approximately `122 MiB`;
- local Docker image size: approximately `368 MB`;
- output SHA-256: `d6d8747a0acb635cf67f6372fbcee6766998a52db86af146b5550cdbcfd773a6`.

This PNG size is not a production storage forecast: the test normalized a color photo rather than a sparse black-and-white coloring page. WP4 must benchmark representative normalized photos and generated coloring pages separately.

## End-to-end hosted result

```text
HTTPS development Worker
  -> hosted R2 Source Photo
  -> hosted D1 source record
  -> hosted Workflow
  -> per-run Durable Object
  -> Cloudflare Container running Node 22 + Sharp
  -> hosted R2 normalized PNG
  -> hosted D1 artifact and terminal run state
```

The hosted validation used a non-customer marketing image:

- source: `5,218,469` bytes;
- normalized PNG: `5,844,096` bytes;
- first cold run: approximately `16s` from run creation to completed D1 state;
- second cold run: approximately `13s`;
- both outputs had SHA-256 `667eafb400ad8cd64c341ae32e52c0f5539c8f46d0876d3d713c79390d77d5aa`;
- Cloudflare reported zero active Container instances between the two runs;
- replaying the first run left exactly one associated run, operation, and artifact.

## Platform findings

- Workflows, D1, and R2 all support local development through Wrangler. Workflow local execution is emulated; D1 uses the same engine version as the hosted service.
- The repository already contained `apps/functions/wrangler.toml`. Wrangler therefore remains the project-local development and deployment tool. The `cf` CLI remains appropriate for supported account resource discovery and management.
- Workflows are available on Free and Paid plans, but production sizing uses Paid assumptions because Containers are part of the architecture.
- R2 remains a good fit for artifacts because the API is S3-compatible, storage is inexpensive, and Internet egress is currently free. S3 compatibility is not complete; code must use only documented supported operations.
- D1's Free limits are adequate for this spike. Production should use indexed access patterns because billing is based on rows read and written.
- Containers are enabled through the Workers Paid plan and then bill active memory, CPU, disk, and network usage after included allowances.

## Cost posture

At the measured spike sizes, Cloudflare infrastructure cost is expected to be small compared with image-model generation cost:

- one 20 MB combined source/output footprint is roughly `$0.0003` per month in R2 Standard storage before retention and additional Candidates;
- D1 and Workflow use should remain inside included Paid allowances at early MVP volume;
- Workers Paid establishes a `$5/month` platform floor if Containers are used;
- no reliable per-page Container figure is claimed until the remote runtime is benchmarked, because provisioned instance size, sleep behavior, internal transfer, and actual coloring-page output sizes affect it.

Provider generation, Style QA, and repair calls are not included in these infrastructure estimates.

## Known spike limitations

- The Worker currently streams image bytes between R2 and the Container. ADR 0002's preferred production boundary has the Container read and write R2 directly; WP4 must validate that boundary with scoped S3 credentials or an approved Cloudflare-native connection.
- Source upload currently allows replacing a deterministic spike key. Production artifacts must be immutable revisions.
- The spike has no authentication or customer authorization.
- The spike validates one normalization operation, not generation, Print QA, Style QA, or bounded repair.
- Peak Container CPU and memory under concurrent pages remain unmeasured.
- The hosted spike endpoint has no authentication. `workers_dev` was disabled after validation so the endpoint is not left publicly writable.

## Next productionization work

1. extract infrastructure-neutral pipeline ports in WP1;
2. replace overwriteable spike keys with immutable artifact revisions;
3. implement authentication and ownership authorization before exposing another route;
4. benchmark page concurrency and choose a bounded Container pool strategy;
5. compare Worker-streamed images with direct Container-to-R2 access;
6. record billed CPU, memory, disk, and transfer after representative multi-page tests.

## Official references

- [Workflows local development](https://developers.cloudflare.com/workflows/build/local-development/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Containers limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
