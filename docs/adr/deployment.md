# Production-Only Hosted Delivery

Status: `accepted`
Owners: `worker`

Historical upstream decision; current work follows the local-only
[repository workflow](../workflow.md). The retained Worker is replaced in T003.

Upstream Production was the only hosted channel; every merged
non-documentation change deployed its exact `main` commit with mandatory
verification and rollback. Preview had drifted and added a workflow,
promotion and credentials without evidence beyond PR checks plus Production
verification. Its Worker stayed as route-free storage because deleting it could
make Durable Object data unrecoverable.
