# Transaction boundary

Durable writes happen through a repository boundary so HTTP handlers do not embed persistence details.

## Verification

This decision is represented in source, tests, SQL, or deployment configuration and should remain reviewable.

