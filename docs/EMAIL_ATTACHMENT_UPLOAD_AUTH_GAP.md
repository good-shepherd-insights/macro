# Email Attachment Upload Auth Gap (tabled, not fixed)

## Status

**Not fixed. Deliberately deferred.** This documents a real, reproduced issue
found while getting Gmail inbox sync working locally over the Cloudflare
Tunnel. Nothing in this doc has been applied — no code or config changed as
a result of it yet.

## Symptom

Gmail backfill/sync silently fails to upload email attachments. The failure
is non-fatal and swallowed: `email_pubsub_workers`' backfill error handler
logs "Non-retryable error processing message. The message will be deleted"
and moves on — no user-facing error, no alert, attachments simply never
appear on synced messages.

## Root cause

`email_service` sends the wrong shared secret when calling
`document-storage-service` to create an attachment's document record.

- `email_service`'s `DocumentStorageServiceClient` (both
  `services/email_service/src/main.rs:126` and
  `services/email_service/src/bin/pubsub_workers/pubsub_workers.rs:314`) is
  constructed with `config.internal_api_key` (`INTERNAL_API_KEY`).
- `document-storage-service`'s own internal-auth check
  (`crates/macro_authorization/src/domain/service.rs:134`,
  `constant_time_eq(provided_key, self.internal_auth.api_key)`) validates
  against a *different* secret, `DOCUMENT_STORAGE_SERVICE_AUTH_KEY`, wired
  in `services/document_storage_service/src/main.rs:276` via
  `DocumentStorageServiceAuthKey::new()`.
- Every other caller of `DocumentStorageServiceClient` in the codebase uses
  a DSS-specific key for this call, not `internal_api_key`:
  `document_cognition_service` (`config.document_storage_service_auth_key`),
  `authentication_service` (`config.service_internal_auth_key`),
  `search_upload_handler` (`DocumentStorageServiceAuthKey::new()`),
  `upload_extractor_lambda_handler` (`internal_api_secret_key`).
  `email_service` is the only outlier, and its `Config` struct doesn't even
  have a `document_storage_service_auth_key` field defined.

## Evidence (reproduced live, not assumed)

```
sudo docker logs macro-document_storage_service-1
  macro_authorization::inbound::axum::internal: internal authorization failed, error: InvalidCredentials
```

Reproduced directly: sent `document-storage-service` the exact
`INTERNAL_API_KEY` value `email_service` sends, with the correct legacy
header name (`x-document-storage-service-auth-key`) — still `401`, because
the service validates against `DOCUMENT_STORAGE_SERVICE_AUTH_KEY`
(`local-dev-placeholder` locally), a different value.

## Whether this affects production

**Unknown, and not something we can verify from here.** If
`INTERNAL_API_KEY` and `DOCUMENT_STORAGE_SERVICE_AUTH_KEY` happen to be set
to the same real value in Doppler for prod, this exact code path works
there today despite reading what looks like the wrong field locally — the
mismatch this repro depends on wouldn't exist. No claim is made here about
production impact; this is scoped to what was verified in this local stack.

## Two possible fixes, neither applied

1. **Config-only (smaller, no code touched):** set
   `DOCUMENT_STORAGE_SERVICE_AUTH_KEY=local` in `local.env` to match the
   existing `INTERNAL_API_KEY=local`. Since the check is a plain string
   comparison with no format requirement, this alone makes the existing
   code authorize successfully. Only fixes this local stack; doesn't touch
   whatever `email_service` does anywhere else.
2. **Code fix (matches the pattern every other caller uses):** add
   `DocumentStorageServiceAuthKey` to `email_service/src/config.rs`'s
   `env_vars!` block and `Config` struct (same shape as
   `document_cognition_service`'s), then swap `config.internal_api_key` →
   `config.document_storage_service_auth_key` at both
   `DocumentStorageServiceClient::new(...)` call sites. Addresses the
   underlying inconsistency directly, wherever it runs — but is a source
   change, not yet requested.

## Storage backend, for context

Where attachments land depends on mime type
(`services/email_service/src/backfill_completion_service.rs:511-517`):
images/video → static-file-service (bucket `static-file-storage`);
everything else → document-storage-service (bucket `doc-storage`). Both are
S3 buckets, backed locally by LocalStack, persisted in the `localstack`
Docker volume — wiped on every full `just run_local` teardown regardless of
this auth issue.
