package com.pass.credentialprovider

import android.content.Context
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.ProviderClearCredentialStateRequest

object PassProviderRepository {
    fun beginCreateCredential(
        context: Context,
        request: BeginCreateCredentialRequest,
    ): BeginCreateCredentialResponse? {
        // Query phase hook. Populate CreateEntry pending intents here after the
        // Android client is wired to the encrypted Pass vault.
        return BeginCreateCredentialResponse(emptyList(), null)
    }

    fun beginGetCredential(
        context: Context,
        request: BeginGetCredentialRequest,
    ): BeginGetCredentialResponse? {
        // Query phase hook. Populate PasswordCredentialEntry and
        // PublicKeyCredentialEntry pending intents here after vault unlock.
        return BeginGetCredentialResponse(emptyList(), emptyList(), emptyList(), null)
    }

    fun clearCredentialState(
        context: Context,
        request: ProviderClearCredentialStateRequest,
    ) {
        // Reserved for sticky account selections and unlock sessions.
    }
}
