package com.pass.credentialprovider

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialOption
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Query-phase repository for the Android Credential Provider.
 *
 * Demo vault path: `filesDir/pass_demo_vault.json` (seeded from assets on first read).
 *
 * Query phase returns [PasswordCredentialEntry] metadata + [PendingIntent] only.
 * Passwords are never attached at query time.
 */
object PassProviderRepository {
    private const val TAG = "PassProviderRepo"
    const val DEMO_VAULT_FILE = "pass_demo_vault.json"
    private const val ASSET_DEMO_VAULT = "pass_demo_vault.json"

    const val EXTRA_ACTION = "pass.action"
    const val EXTRA_ACCOUNT_ID = "pass.accountId"
    const val EXTRA_USERNAME = "pass.username"
    const val EXTRA_SITES = "pass.sites"
    const val EXTRA_CALLING_PACKAGE = "pass.callingPackage"
    const val ACTION_GET = "get"
    const val ACTION_CREATE = "create"

    fun beginCreateCredential(
        context: Context,
        request: BeginCreateCredentialRequest,
    ): BeginCreateCredentialResponse {
        Log.i(TAG, "beginCreateCredential type=${request.type}")
        val intent = Intent(context, PassCredentialSettingsActivity::class.java).apply {
            putExtra(EXTRA_ACTION, ACTION_CREATE)
            request.callingAppInfo?.packageName?.let {
                putExtra(EXTRA_CALLING_PACKAGE, it)
            }
        }
        val pending = PendingIntent.getActivity(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val entry = CreateEntry.Builder("Pass", pending).build()
        return BeginCreateCredentialResponse(
            createEntries = listOf(entry),
            remoteEntry = null,
        )
    }

    fun beginGetCredential(
        context: Context,
        request: BeginGetCredentialRequest,
    ): BeginGetCredentialResponse {
        val passwordOptions =
            request.beginGetCredentialOptions.filterIsInstance<BeginGetPasswordOption>()
        val allAccounts = loadDemoAccounts(context).filter { !it.isDeleted }
        // CallingAppInfo.origin is module-internal in credentials 1.7.x; only packageName is public.
        val callingPackage = request.callingAppInfo?.packageName.orEmpty()

        Log.i(
            TAG,
            "beginGetCredential passwordOptions=${passwordOptions.size} " +
                "demoAccounts=${allAccounts.size} callingPackage=$callingPackage",
        )

        if (allAccounts.isEmpty() || passwordOptions.isEmpty()) {
            return BeginGetCredentialResponse()
        }

        // Bind entries to each password option (required by PasswordCredentialEntry.Builder).
        val entries = buildList {
            passwordOptions.forEachIndexed { optionIndex, option ->
                val candidates = filterAccountsForOption(allAccounts, option)
                candidates.forEachIndexed { accountIndex, account ->
                    buildPasswordEntry(
                        context = context,
                        account = account,
                        option = option,
                        requestCode = 2000 + optionIndex * 1000 + accountIndex,
                        callingPackage = callingPackage,
                    )?.let { add(it) }
                }
            }
        }

        Log.i(TAG, "beginGetCredential returning ${entries.size} password entries")
        return BeginGetCredentialResponse(
            credentialEntries = entries,
            actions = emptyList(),
            authenticationActions = emptyList(),
            remoteEntry = null,
        )
    }

    fun clearCredentialState(
        context: Context,
        request: ProviderClearCredentialStateRequest,
    ) {
        Log.i(TAG, "clearCredentialState")
    }

    /**
     * Loads demo accounts from `filesDir/pass_demo_vault.json`.
     * If the file is missing, copies the bundled asset once (dev convenience).
     */
    fun loadDemoAccounts(context: Context): List<DemoAccount> {
        ensureDemoVaultSeeded(context)
        val file = File(context.filesDir, DEMO_VAULT_FILE)
        if (!file.isFile) return emptyList()
        return try {
            parseDemoVault(file.readText())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse demo vault: ${e.message}")
            emptyList()
        }
    }

    fun ensureDemoVaultSeeded(context: Context) {
        val file = File(context.filesDir, DEMO_VAULT_FILE)
        if (file.isFile) return
        try {
            context.assets.open(ASSET_DEMO_VAULT).use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            Log.i(TAG, "Seeded demo vault at ${file.absolutePath}")
        } catch (e: Exception) {
            Log.w(TAG, "No demo vault asset to seed: ${e.message}")
        }
    }

    fun parseDemoVault(json: String): List<DemoAccount> {
        val root = JSONObject(json)
        val arr: JSONArray = root.optJSONArray("accounts") ?: JSONArray()
        return buildList {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val sitesArr = obj.optJSONArray("sites") ?: JSONArray()
                val sites = buildList {
                    for (j in 0 until sitesArr.length()) {
                        val s = sitesArr.optString(j, "").trim()
                        if (s.isNotEmpty()) add(normalizeDomain(s))
                    }
                }
                add(
                    DemoAccount(
                        id = obj.optString("id", "demo-$i"),
                        username = obj.optString("username", ""),
                        sites = sites,
                        isDeleted = obj.optBoolean("isDeleted", false),
                    ),
                )
            }
        }
    }

    data class DemoAccount(
        val id: String,
        val username: String,
        val sites: List<String>,
        val isDeleted: Boolean,
    ) {
        fun matchesDomain(hint: String): Boolean {
            val h = normalizeDomain(hint)
            if (h.isEmpty()) return false
            return sites.any { s -> s == h || s.endsWith(".$h") || h.endsWith(".$s") }
        }

        fun displayLabel(): String {
            val site = sites.firstOrNull().orEmpty()
            return when {
                username.isBlank() && site.isBlank() -> id
                username.isBlank() -> site
                site.isEmpty() -> username
                else -> "$username · $site"
            }
        }
    }

    fun normalizeDomain(raw: String): String {
        var value = raw.trim().lowercase(Locale.US)
        if (value.startsWith("http://") || value.startsWith("https://")) {
            value = try {
                java.net.URI(value).host ?: value
            } catch (_: Exception) {
                value
            }
        }
        // Strip path fragments if a bare host/path slipped in without scheme.
        val slash = value.indexOf('/')
        if (slash >= 0) {
            value = value.substring(0, slash)
        }
        while (value.endsWith(".")) {
            value = value.dropLast(1)
        }
        return value
    }

    private fun filterAccountsForOption(
        accounts: List<DemoAccount>,
        option: BeginGetPasswordOption,
    ): List<DemoAccount> {
        val allowed = option.allowedUserIds
        if (allowed.isEmpty()) return accounts
        return accounts.filter { it.username in allowed || it.id in allowed }
    }

    private fun buildPasswordEntry(
        context: Context,
        account: DemoAccount,
        option: BeginGetCredentialOption,
        requestCode: Int,
        callingPackage: String,
    ): PasswordCredentialEntry? {
        return runCatching {
            val username = account.username.ifBlank { account.id.ifBlank { "account" } }
            val intent = Intent(context, PassCredentialSettingsActivity::class.java).apply {
                // Distinct action+data so FLAG_UPDATE_CURRENT keeps per-account extras.
                action = "com.pass.credentialprovider.GET_CREDENTIAL"
                data = android.net.Uri.parse(
                    "pass://credential/${account.id}?rc=$requestCode",
                )
                putExtra(EXTRA_ACTION, ACTION_GET)
                putExtra(EXTRA_ACCOUNT_ID, account.id)
                putExtra(EXTRA_USERNAME, account.username)
                putExtra(EXTRA_SITES, account.sites.joinToString(","))
                if (callingPackage.isNotEmpty()) {
                    putExtra(EXTRA_CALLING_PACKAGE, callingPackage)
                }
            }
            val pending = PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            PasswordCredentialEntry.Builder(
                context,
                username,
                pending,
                option as BeginGetPasswordOption,
            )
                .setDisplayName(account.displayLabel())
                .build()
        }.onFailure { e ->
            Log.w(TAG, "skip entry ${account.id}: ${e.message}")
        }.getOrNull()
    }
}
