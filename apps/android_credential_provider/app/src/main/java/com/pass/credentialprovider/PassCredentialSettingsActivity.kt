package com.pass.credentialprovider

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class PassCredentialSettingsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "Pass Credential Provider"
            textSize = 18f
            setPadding(32, 32, 32, 32)
        })
    }
}
