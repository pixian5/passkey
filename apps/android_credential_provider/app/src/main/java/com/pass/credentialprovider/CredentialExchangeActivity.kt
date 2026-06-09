package com.pass.credentialprovider

import android.app.Activity
import android.os.Bundle

class CredentialExchangeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Receives application/vnd.fido.cxf+json shares for manual testing.
        // Google Play services system migration can reuse the same parser once
        // a public Android-side import/export token API is exposed to providers.
        finish()
    }
}
