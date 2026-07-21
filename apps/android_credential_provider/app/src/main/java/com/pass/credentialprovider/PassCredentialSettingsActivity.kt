package com.pass.credentialprovider

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Confirmation / settings surface opened from credential PendingIntents.
 *
 * Demo mode shows selected account metadata only. Password fill requires vault unlock
 * and a PendingIntent result back to Credential Manager — not wired yet.
 */
class PassCredentialSettingsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Touch the demo vault so settings can confirm seed/load state.
        val demoCount = PassProviderRepository.loadDemoAccounts(this).count { !it.isDeleted }

        val action = intent?.getStringExtra(PassProviderRepository.EXTRA_ACTION).orEmpty()
        val accountId = intent?.getStringExtra(PassProviderRepository.EXTRA_ACCOUNT_ID).orEmpty()
        val username = intent?.getStringExtra(PassProviderRepository.EXTRA_USERNAME).orEmpty()
        val sites = intent?.getStringExtra(PassProviderRepository.EXTRA_SITES).orEmpty()
        val callingPackage =
            intent?.getStringExtra(PassProviderRepository.EXTRA_CALLING_PACKAGE).orEmpty()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        fun line(text: String, size: Float = 16f) {
            root.addView(
                TextView(this).apply {
                    this.text = text
                    textSize = size
                    setPadding(0, 0, 0, 24)
                },
            )
        }

        line("Pass Credential Provider", 20f)
        when (action) {
            PassProviderRepository.ACTION_CREATE -> {
                line("Create credential request (demo)")
                line("callingPackage: ${callingPackage.ifBlank { "—" }}")
                line(
                    "Full create flow is not wired. After the encrypted Android vault is " +
                        "connected, this screen will collect username/password and finish " +
                        "the PendingIntent result for Credential Manager.",
                )
            }
            PassProviderRepository.ACTION_GET -> {
                line("Account selected (demo — password not returned)")
                line("accountId: ${accountId.ifBlank { "—" }}")
                line("username: ${username.ifBlank { "—" }}")
                line("sites: ${sites.ifBlank { "—" }}")
                line("callingPackage: ${callingPackage.ifBlank { "—" }}")
                line(
                    "Query phase never includes passwords. Real autofill requires unlocking " +
                        "the encrypted vault and completing the PendingIntent result " +
                        "(GetCredentialResponse) — vault connection is not wired yet.",
                )
            }
            else -> {
                line("Settings / debug")
                line("Demo vault file: filesDir/${PassProviderRepository.DEMO_VAULT_FILE}")
                line("Active demo accounts: $demoCount")
                line(
                    "On first launch the app seeds a sample vault from assets if the file " +
                        "is missing. Override by pushing your own JSON to the sandbox path.",
                )
                line(
                    "Enable this app under System Settings → Passwords & accounts → " +
                        "Preferred service / Additional providers (wording varies by OEM).",
                )
            }
        }

        setContentView(
            ScrollView(this).apply {
                addView(root)
            },
        )
    }
}
