// Explicit implementation allowlist to be populated in a later release; no arbitrary module loading.
export async function invoke() { throw new Error('INTERNAL_SPECIALIST_NOT_REGISTERED'); }
