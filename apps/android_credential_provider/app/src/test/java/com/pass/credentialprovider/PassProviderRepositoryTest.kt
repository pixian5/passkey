package com.pass.credentialprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PassProviderRepositoryTest {
    @Test
    fun parseDemoVault_readsAccounts() {
        val json =
            """
            {
              "accounts": [
                {"id":"1","username":"alice","sites":["Example.COM","https://login.example.com/x"],"isDeleted":false},
                {"id":"2","username":"bob","sites":["other.test"],"isDeleted":true}
              ]
            }
            """.trimIndent()
        val accounts = PassProviderRepository.parseDemoVault(json)
        assertEquals(2, accounts.size)
        assertEquals("alice", accounts[0].username)
        assertTrue(accounts[0].sites.contains("example.com"))
        assertTrue(accounts[0].sites.contains("login.example.com"))
        assertTrue(accounts[0].matchesDomain("login.example.com"))
        assertTrue(accounts[0].matchesDomain("example.com"))
        assertTrue(accounts[1].isDeleted)
        assertFalse(accounts[1].matchesDomain("example.com"))
    }

    @Test
    fun normalizeDomain_stripsSchemeAndPath() {
        assertEquals(
            "host.example",
            PassProviderRepository.normalizeDomain("https://Host.Example/path"),
        )
        assertEquals(
            "login.example.com",
            PassProviderRepository.normalizeDomain("login.example.com/auth"),
        )
    }

    @Test
    fun displayLabel_includesSiteWhenPresent() {
        val account = PassProviderRepository.DemoAccount(
            id = "1",
            username = "alice",
            sites = listOf("example.com"),
            isDeleted = false,
        )
        assertEquals("alice · example.com", account.displayLabel())
    }

    @Test
    fun parseDemoVault_emptyAccounts() {
        assertTrue(PassProviderRepository.parseDemoVault("""{"accounts":[]}""").isEmpty())
        assertTrue(PassProviderRepository.parseDemoVault("{}").isEmpty())
    }
}
