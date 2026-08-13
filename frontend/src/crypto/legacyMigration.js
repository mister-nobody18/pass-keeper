// One-time, transparent upgrade path for accounts that predate the DEK/
// envelope model (see docs/ARCHITECTURE.md §6). A real account that existed
// before this feature shipped has its vault encrypted directly by a
// password-derived key - no DEK, no wrapped_dek_password. This resolves a
// login response into a usable vault key either way, migrating a legacy
// account on the spot when needed. Used by both AuthContext.login() and
// VaultLockContext.unlock() so this logic exists in exactly one place.

import { generateDek, wrapDek, unwrapDek } from './dek.js';
import { decryptVault, encryptVault } from './vaultCipher.js';
import { api } from '../api/client.js';

/**
 * @param {{ wrappedDekPassword: string | null }} data - a login.php response
 * @param {CryptoKey} passwordWrapKey - the password-derived key from this
 *   login attempt. Has both wrapKey/unwrapKey AND encrypt/decrypt usages
 *   (see crypto/kdfWorker.js) - the latter is what makes the legacy path
 *   below possible without a second derivation.
 * @param {(phase: 'upgrading') => void} [onPhase]
 * @returns {Promise<CryptoKey>} a working vault key - always usable to
 *   encrypt/decrypt the vault, regardless of which path was taken.
 */
export async function resolveDekAfterLogin(data, passwordWrapKey, onPhase) {
    if (data.wrappedDekPassword) {
        // Already on the DEK model - normal path.
        return unwrapDek(data.wrappedDekPassword, passwordWrapKey);
    }

    onPhase?.('upgrading');

    // Legacy account: no DEK yet. In the old (pre-envelope) model,
    // passwordWrapKey WAS the vault's actual encryption key - decrypt with
    // it directly, exactly as the app did before this feature existed.
    const { ciphertext, revision } = await api.getVault();
    const entries = await decryptVault(ciphertext, passwordWrapKey);

    const extractableDek = await generateDek();
    const wrappedDekPassword = await wrapDek(extractableDek, passwordWrapKey);
    const workingDek = await unwrapDek(wrappedDekPassword, passwordWrapKey);
    const newCiphertext = await encryptVault(entries, workingDek);

    try {
        await api.migrateVault({
            newWrappedDekPassword: wrappedDekPassword,
            newVaultCiphertext: newCiphertext,
            expectedVaultRevision: revision,
        });
        return workingDek;
    } catch (err) {
        // Don't block the user from their own vault over a migration
        // hiccup (network drop, a losing race against another tab/device,
        // a stale revision) - fall back to using the vault directly with
        // passwordWrapKey for THIS session, exactly as the old model did.
        // wrapped_dek_password stays NULL server-side until a migration
        // actually commits, so this is retried automatically on the next
        // login - no data is lost and nothing is left in a half-migrated
        // state either way, since migrate_vault.php's two updates commit
        // or roll back together.
        console.error('Vault migration to the DEK model failed; will retry on next login.', err);
        return passwordWrapKey;
    }
}
