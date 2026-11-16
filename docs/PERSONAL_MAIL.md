# Personal mailboxes — additive integration

This feature is implemented on a review branch. **Do not merge to production before real-provider acceptance tests.** The firm's existing Google/Drive and validated shared-agent mail continue to use their original tables and routes.

## Deployment prerequisites

1. db/personal-mail.sql is included in db/INSTALL_TOUT.sql through scripts/build-install-sql.mjs. The VPS deploy receiver tests and runs INSTALL_TOUT.sql only when that file differs. Confirm the three new tables exist after the migration.
2. Set the stable, server-only PERSONAL_MAIL_ENCRYPTION_KEY (32+ random characters). Never change it without re-encrypting tokens. Never commit credentials.
3. Google: reuse the existing web OAuth ID and secret. Register https://<firm-host>/oauth/google/callback; enable Gmail API and gmail.readonly + gmail.send scopes. Gmail readonly is a restricted scope: production verification and security requirements may apply. For preview tests, PERSONAL_MAIL_GOOGLE_REDIRECT_URI must be registered as a separate callback.
4. Microsoft: register a multi-tenant Entra ID web app supporting personal Microsoft accounts, with delegated Mail.Read, Mail.Send, User.Read and offline_access. Configure MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_MAIL_REDIRECT_URI=https://<firm-host>/api/app?route=personal-mail-callback.
5. Each employee goes to Accueil → Ma messagerie, connects their own box, and separately consents before message snippets are sent to the external AI provider.

## Isolation

- Personal credentials: office_email_accounts, scoped by org_id, user_id, provider and email; AES-256-GCM encrypted with account-bound associated data. Existing office_google_connections stays untouched.
- Summaries and cached metadata: office_personal_mail_items. Drafts: office_personal_mail_drafts. Both are scoped by org_id, user_id and mailbox_id.
- Every API action validates the current user. **Cabinet owners cannot read employees' private mail without an explicit future sharing mechanism.**
- Provider requests use delegated permissions for the specific connected user, never the owner's token as a fallback.
- Sending requires human confirmation and an atomic draft-state transition. Ambiguous network failures are never retried automatically.
- Disconnect deletes the personal account, cached snippets and drafts. Shared Drive and firm mailbox data stay intact.
- AI is disabled until user consent; nothing is written to the common mail triage/Drive memory.

## Current limitations

This is a secure first increment, NOT a verified complete Gmail/Outlook replacement.

- Sync on page load/manual refresh checks up to 20 recent messages per folder in the current provider query; historical pagination and offline background sync are not implemented.
- Search is over locally synchronized messages, not all provider history.
- AI suggests actions and drafts, but no automatic mission attachment or task creation occurs without an authorization workflow.
- Formal client correspondence subject to firm review must continue through the existing validated firm messaging workflow.
- Mocked tests exist for OAuth, isolation, token refresh, AI backfill and sending. **Two real account tests, Google OAuth verification and Microsoft tenant consent remain to be done before production.**

## Acceptance checks

1. A sees only their own mailbox and drafts; collaborator B sees only B; neither sees the other.
2. Tenant C cannot access mailbox A, including by changing API mailbox IDs.
3. The AI produces per-user proposals only after consent, and a draft is reviewed before sending.
4. Gmail/Outlook send from the correct connected identity. Repeated button clicks cause no double send.
5. Revocation, consent denial, provider failure, empty inbox and AI errors have explicit states.
6. Existing Drive, agents, mission pages, shared mail and validation circuit still function.

## Deployment and rollback

The CI on the fix/personal-mailboxes-20261116 branch runs repository syntax, regression and SQL tests. It does **not** run the VPS production deploy, which triggers only on production. Test in a separate preview after registering that preview's OAuth callbacks. Keep the old firm connections during rollout. Roll back by disabling the UI and routes; do not automatically delete tables containing user data.
