# Cabinet registration — preparation, not a released multi-tenant product

Requested behavior: a responsible person creates their login and their own cabinet
in the current Supabase project. Other cabinets' documents and data stay separate.

This change prepares only server-side registration and atomic cabinet creation.
It does not yet deliver that complete flow. The endpoint is disabled unless
`OFFICE_MANAGER_CABINET_ONBOARDING=on`. Do not enable it for customers yet.

## What this patch does

- Uses Supabase's normal signup, leaving email confirmation to Auth.
- Verifies the bearer token with Auth `/user` and requires confirmed email.
- Takes identity and email from that verified response, never from submitted IDs.
- Creates a new organization, its owner in both existing membership models and
  an idempotency record in one server-only SQL transaction.
- Never copies pilot documents, Google credentials, agent approvals or data.
- Never returns the pilot access token or owner secret.
- Leaves every existing login and operational route unchanged.

The SQL is a reviewed deployment script in the repository's existing `db/` format,
not an applied hosted migration. No hosted database or environment was changed.

## Remaining work before activation

1. Add the registration/confirmation/login UI and password recovery.
2. Resolve every operational request's organization from a verified membership,
   rather than `DEFAULT_ORG_ID`; use membership roles for owner authorization.
3. Replace shared Google/token/Drive/Shadow caches with request or tenant scope;
   prevent new cabinets from using server credentials and legacy pilot fallbacks.
4. Scope service-role reads, writes, RPCs and scheduled jobs to the verified cabinet.
   Check database policies, grants and cross-organization object references.
5. Exercise two separate synthetic cabinets end to end, including concurrent
   requests, team permissions, document access, logout and the existing pilot.
6. Review the complete change, install the SQL on the current project and activate
   the feature only after those checks pass. Configure confirmation mail delivery
   and authorized return URLs in Supabase before external signup.

This branch must remain a draft until these steps are complete.
