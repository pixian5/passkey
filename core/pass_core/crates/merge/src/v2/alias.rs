//! Alias-group sync: when accounts share a site, the same eTLD+1, or an
//! explicitly configured provider alias group, union their sites.
//!
//! Matches macOS `AccountStore.syncAliasGroups` (index BFS / component merge).

use super::normalize::{etld_plus_one, normalize_sites};
use super::types::PasswordAccount;

const DOMAIN_ALIAS_GROUPS: &[(&str, &[&str])] = &[
    (
        "apple",
        &["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"],
    ),
    ("qq", &["qq.com", "wx.qq.com"]),
    (
        "baidu",
        &["baidu.com", "passport.baidu.com", "pan.baidu.com"],
    ),
    ("sina", &["sina.com", "mail.sina.com", "weibo.com"]),
    ("github", &["github.com", "gist.github.com"]),
    ("gitlab", &["gitlab.com", "about.gitlab.com"]),
    ("google", &["google.com", "accounts.google.com"]),
    ("youtube", &["youtube.com", "studio.youtube.com"]),
    ("x", &["x.com", "twitter.com"]),
    ("facebook", &["facebook.com", "messenger.com"]),
    ("amazon", &["amazon.com", "smile.amazon.com"]),
    (
        "microsoft",
        &[
            "microsoft.com",
            "microsoftonline.com",
            "login.microsoftonline.com",
            "login.microsoft.com",
            "account.microsoft.com",
            "live.com",
            "hotmail.com",
            "outlook.com",
            "account.live.com",
            "office.com",
            "outlook.office.com",
            "microsoft365.com",
            "office365.com",
            "azure.com",
            "msn.com",
        ],
    ),
    ("paypal", &["paypal.com"]),
    ("netflix", &["netflix.com", "help.netflix.com"]),
    ("spotify", &["spotify.com", "open.spotify.com"]),
    ("linkedin", &["linkedin.com"]),
    ("dropbox", &["dropbox.com"]),
];

fn domain_alias_group_key(domain: &str) -> Option<&'static str> {
    DOMAIN_ALIAS_GROUPS.iter().find_map(|(id, aliases)| {
        aliases
            .iter()
            .any(|alias| {
                domain == *alias
                    || domain
                        .strip_suffix(alias)
                        .is_some_and(|prefix| prefix.ends_with('.'))
            })
            .then_some(*id)
    })
}

/// Union site aliases across connected accounts.
///
/// Connectivity: site-set overlap **or** any pair of sites with the same eTLD+1
/// **or** any pair of sites in the same explicit provider alias group.
/// Only components with 2+ accounts are rewritten; `updated_at_ms` / device name
/// are touched when an account's site list changes.
pub fn sync_alias_groups(accounts: &mut [PasswordAccount], now_ms: i64, device_name: &str) -> bool {
    if accounts.len() < 2 {
        return false;
    }

    let n = accounts.len();
    let site_sets: Vec<Vec<String>> = accounts.iter().map(|a| normalize_sites(&a.sites)).collect();
    let etld_sets: Vec<std::collections::BTreeSet<String>> = site_sets
        .iter()
        .map(|sites| {
            sites
                .iter()
                .map(|s| etld_plus_one(s))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .collect();
    let alias_group_sets: Vec<std::collections::BTreeSet<&'static str>> = site_sets
        .iter()
        .map(|sites| {
            sites
                .iter()
                .filter_map(|site| domain_alias_group_key(site))
                .collect()
        })
        .collect();

    let mut parent: Vec<usize> = (0..n).collect();

    fn find(i: usize, parent: &mut [usize]) -> usize {
        let mut cur = i;
        while parent[cur] != cur {
            cur = parent[cur];
        }
        let root = cur;
        let mut cur2 = i;
        while parent[cur2] != cur2 {
            let next = parent[cur2];
            parent[cur2] = root;
            cur2 = next;
        }
        root
    }

    fn union(a: usize, b: usize, parent: &mut [usize]) {
        let pa = find(a, parent);
        let pb = find(b, parent);
        if pa != pb {
            parent[pb] = pa;
        }
    }

    for i in 0..n {
        for j in (i + 1)..n {
            let si = &site_sets[i];
            let sj = &site_sets[j];
            let overlap = si.iter().any(|s| sj.binary_search(s).is_ok());
            let same_etld = etld_sets[i].iter().any(|e| etld_sets[j].contains(e));
            let same_alias_group = alias_group_sets[i]
                .iter()
                .any(|group| alias_group_sets[j].contains(group));
            if overlap || same_etld || same_alias_group {
                union(i, j, &mut parent);
            }
        }
    }

    let mut components: Vec<Vec<usize>> = vec![Vec::new(); n];
    for i in 0..n {
        let root = find(i, &mut parent);
        components[root].push(i);
    }

    let device = if device_name.trim().is_empty() {
        super::policy::DEFAULT_DEVICE_NAME
    } else {
        device_name.trim()
    };

    let mut any_changed = false;
    for component in components {
        if component.len() < 2 {
            continue;
        }
        let mut merged: Vec<String> = component
            .iter()
            .flat_map(|&idx| site_sets[idx].iter().cloned())
            .collect();
        merged.sort();
        merged.dedup();

        for idx in component {
            if accounts[idx].sites != merged {
                accounts[idx].sites = merged.clone();
                accounts[idx].updated_at_ms = now_ms;
                accounts[idx].last_operated_device_name = device.to_string();
                any_changed = true;
            }
        }
    }

    // Keep sites normalized even when no multi-account component rewrote them.
    for account in accounts.iter_mut() {
        let normalized = normalize_sites(&account.sites);
        if account.sites != normalized {
            account.sites = normalized;
            any_changed = true;
        }
    }

    any_changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acct(sites: &[&str]) -> PasswordAccount {
        PasswordAccount {
            sites: sites.iter().map(|s| s.to_string()).collect(),
            updated_at_ms: 1,
            last_operated_device_name: "Old".into(),
            ..Default::default()
        }
    }

    #[test]
    fn unions_overlapping_sites() {
        let mut accounts = vec![
            acct(&["a.example.com"]),
            acct(&["b.example.com", "a.example.com"]),
            acct(&["other.test"]),
        ];
        let changed = sync_alias_groups(&mut accounts, 99, "Dev");
        assert!(changed);
        assert_eq!(
            accounts[0].sites,
            vec!["a.example.com".to_string(), "b.example.com".to_string()]
        );
        assert_eq!(accounts[0].sites, accounts[1].sites);
        assert_eq!(accounts[0].updated_at_ms, 99);
        assert_eq!(accounts[0].last_operated_device_name, "Dev");
        assert_eq!(accounts[2].sites, vec!["other.test".to_string()]);
        assert_eq!(accounts[2].updated_at_ms, 1);
    }

    #[test]
    fn unions_same_etld_without_exact_site_overlap() {
        let mut accounts = vec![acct(&["login.example.com"]), acct(&["api.example.com"])];
        let changed = sync_alias_groups(&mut accounts, 50, "X");
        assert!(changed);
        assert_eq!(accounts[0].sites, accounts[1].sites);
        assert!(accounts[0].sites.contains(&"login.example.com".to_string()));
        assert!(accounts[0].sites.contains(&"api.example.com".to_string()));
    }

    #[test]
    fn unions_explicit_microsoft_alias_domains() {
        let mut accounts = vec![
            acct(&["microsoft.com"]),
            acct(&["login.microsoftonline.com"]),
        ];
        let changed = sync_alias_groups(&mut accounts, 75, "X");
        assert!(changed);
        assert_eq!(
            accounts[0].sites,
            vec![
                "login.microsoftonline.com".to_string(),
                "microsoft.com".to_string()
            ]
        );
        assert_eq!(accounts[0].sites, accounts[1].sites);
    }

    #[test]
    fn single_account_noop() {
        let mut accounts = vec![acct(&["only.com"])];
        assert!(!sync_alias_groups(&mut accounts, 1, "D"));
    }
}
