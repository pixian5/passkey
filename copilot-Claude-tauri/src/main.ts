import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";

interface PasswordAccount {
  id: string;
  account_id: string;
  canonical_site: string;
  sites: string[];
  username: string;
  password: string;
  totp_secret?: string;
  recovery_codes?: string;
  note?: string;
  folder_id?: string;
  created_at: number;
  updated_at: number;
  deleted: boolean;
}

interface AccountFolder {
  id: string;
  name: string;
  matched_sites: string[];
  auto_add_matching: boolean;
}

class App {
  private isLocked = true;
  private accounts: PasswordAccount[] = [];
  private folders: AccountFolder[] = [];
  private currentView = "all";
  private searchQuery = "";

  async init() {
    await this.checkLockStatus();
    if (this.isLocked) {
      this.renderLockScreen();
    } else {
      await this.loadData();
      this.render();
    }
  }

  async checkLockStatus() {
    try {
      this.isLocked = await invoke<boolean>("is_locked");
    } catch (e) {
      this.isLocked = true;
    }
  }

  renderLockScreen() {
    const app = document.getElementById("app")!;
    app.innerHTML = `
      <div class="lock-screen">
        <div class="lock-box">
          <h2>🔒 Pass - Password Manager</h2>
          <form id="unlock-form">
            <div class="form-group">
              <label>Master Password</label>
              <input type="password" id="master-password" required />
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%">Unlock</button>
          </form>
          <p style="text-align: center; margin-top: 20px; font-size: 12px; color: #7f8c8d;">
            First time? Enter a new master password to initialize.
          </p>
        </div>
      </div>
    `;

    document.getElementById("unlock-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = (document.getElementById("master-password") as HTMLInputElement).value;
      await this.unlock(password);
    });
  }

  async unlock(password: string) {
    try {
      const home = await homeDir();
      const dbPath = `${home}.pass/pass.db`;

      // Try to initialize or unlock
      try {
        await invoke("initialize_database", { dbPath, masterPassword: password });
        this.showToast("Database initialized successfully");
        this.isLocked = false;
      } catch {
        const success = await invoke<boolean>("unlock_app", { masterPassword: password });
        if (success) {
          this.isLocked = false;
          this.showToast("Unlocked successfully");
        } else {
          this.showToast("Invalid password");
          return;
        }
      }

      await this.loadData();
      this.render();
    } catch (error) {
      this.showToast(`Error: ${error}`);
    }
  }

  async loadData() {
    try {
      this.accounts = await invoke<PasswordAccount[]>("get_all_accounts", {
        includeDeleted: this.currentView === "trash",
      });
      this.folders = await invoke<AccountFolder[]>("get_folders");
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  render() {
    const app = document.getElementById("app")!;
    app.innerHTML = `
      <div class="app-container">
        <div class="sidebar">
          <div class="sidebar-header">Pass</div>
          <div class="sidebar-menu">
            <div class="menu-item ${this.currentView === "all" ? "active" : ""}" data-view="all">
              📋 All Accounts
            </div>
            <div class="menu-item ${this.currentView === "totp" ? "active" : ""}" data-view="totp">
              🔐 TOTP
            </div>
            <div class="menu-item ${this.currentView === "trash" ? "active" : ""}" data-view="trash">
              🗑️ Trash
            </div>
            <hr style="border-color: #34495e; margin: 10px 0;">
            ${this.folders.map((f) => `
              <div class="menu-item ${this.currentView === f.id ? "active" : ""}" data-view="${f.id}">
                📁 ${f.name}
              </div>
            `).join("")}
          </div>
        </div>
        <div class="main-content">
          <div class="header">
            <button class="btn btn-success" id="add-account-btn">+ New Account</button>
            <div class="search-box">
              <input type="text" placeholder="Search accounts..." id="search-input" value="${this.searchQuery}" />
            </div>
            <button class="btn btn-primary" id="sync-btn">🔄 Sync</button>
            <button class="btn btn-danger" id="lock-btn">🔒 Lock</button>
          </div>
          <div class="content-area">
            ${this.renderAccounts()}
          </div>
        </div>
      </div>

      <!-- Account Modal -->
      <div id="account-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">Edit Account</div>
          <form id="account-form">
            <div class="form-group">
              <label>Website / Service</label>
              <input type="text" id="account-site" required />
            </div>
            <div class="form-group">
              <label>Username</label>
              <input type="text" id="account-username" required />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" id="account-password" required />
            </div>
            <div class="form-group">
              <label>TOTP Secret (optional)</label>
              <input type="text" id="account-totp" />
            </div>
            <div class="form-group">
              <label>Notes (optional)</label>
              <textarea id="account-note"></textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-danger" id="cancel-modal-btn">Cancel</button>
              <button type="submit" class="btn btn-success">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderAccounts() {
    let filtered = this.accounts;

    if (this.currentView === "totp") {
      filtered = filtered.filter((a) => a.totp_secret);
    } else if (this.currentView === "trash") {
      filtered = filtered.filter((a) => a.deleted);
    } else if (this.currentView !== "all") {
      filtered = filtered.filter((a) => a.folder_id === this.currentView);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.username.toLowerCase().includes(q) ||
          a.canonical_site.toLowerCase().includes(q) ||
          a.sites.some((s) => s.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      return `
        <div class="empty-state">
          <h3>No accounts found</h3>
          <p>Click "New Account" to add your first password</p>
        </div>
      `;
    }

    return `
      <div class="accounts-grid">
        ${filtered.map((account) => `
          <div class="account-card" data-id="${account.account_id}">
            <h3>${account.canonical_site}</h3>
            <div class="username">${account.username}</div>
            <div class="site">${account.sites.join(", ")}</div>
            ${account.totp_secret ? '<div style="margin-top: 10px; color: #27ae60;">🔐 TOTP Enabled</div>' : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  attachEventListeners() {
    // Menu items
    document.querySelectorAll(".menu-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        this.currentView = (e.target as HTMLElement).dataset.view!;
        this.render();
      });
    });

    // Search
    const searchInput = document.getElementById("search-input") as HTMLInputElement;
    searchInput?.addEventListener("input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.render();
    });

    // Add account
    document.getElementById("add-account-btn")?.addEventListener("click", () => {
      this.showAccountModal();
    });

    // Account cards
    document.querySelectorAll(".account-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        this.showAccountModal(id);
      });
    });

    // Sync
    document.getElementById("sync-btn")?.addEventListener("click", async () => {
      try {
        await invoke("sync_with_server");
        this.showToast("Synced successfully");
        await this.loadData();
        this.render();
      } catch (error) {
        this.showToast(`Sync error: ${error}`);
      }
    });

    // Lock
    document.getElementById("lock-btn")?.addEventListener("click", async () => {
      await invoke("lock_app");
      this.isLocked = true;
      this.renderLockScreen();
    });
  }

  showAccountModal(accountId?: string) {
    const modal = document.getElementById("account-modal")!;
    modal.classList.add("active");

    if (accountId) {
      const account = this.accounts.find((a) => a.account_id === accountId);
      if (account) {
        (document.getElementById("account-site") as HTMLInputElement).value = account.canonical_site;
        (document.getElementById("account-username") as HTMLInputElement).value = account.username;
        (document.getElementById("account-password") as HTMLInputElement).value = account.password;
        (document.getElementById("account-totp") as HTMLInputElement).value = account.totp_secret || "";
        (document.getElementById("account-note") as HTMLTextAreaElement).value = account.note || "";
      }
    }

    const form = document.getElementById("account-form")!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.saveAccount(accountId);
      modal.classList.remove("active");
    };

    document.getElementById("cancel-modal-btn")!.onclick = () => {
      modal.classList.remove("active");
    };
  }

  async saveAccount(accountId?: string) {
    const site = (document.getElementById("account-site") as HTMLInputElement).value;
    const username = (document.getElementById("account-username") as HTMLInputElement).value;
    const password = (document.getElementById("account-password") as HTMLInputElement).value;
    const totp = (document.getElementById("account-totp") as HTMLInputElement).value;
    const note = (document.getElementById("account-note") as HTMLTextAreaElement).value;

    const now = Date.now();

    const account: PasswordAccount = {
      id: accountId || this.generateId(),
      account_id: accountId || this.generateId(),
      canonical_site: site,
      sites: [site],
      username,
      password,
      totp_secret: totp || undefined,
      note: note || undefined,
      folder_id: undefined,
      recovery_codes: undefined,
      created_at: now,
      updated_at: now,
      deleted: false,
    };

    try {
      if (accountId) {
        await invoke("update_account", { account });
        this.showToast("Account updated");
      } else {
        await invoke("create_account", { account });
        this.showToast("Account created");
      }
      await this.loadData();
      this.render();
    } catch (error) {
      this.showToast(`Error: ${error}`);
    }
  }

  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  showToast(message: string) {
    const toast = document.getElementById("toast")!;
    toast.textContent = message;
    toast.classList.add("active");
    setTimeout(() => {
      toast.classList.remove("active");
    }, 3000);
  }
}

// Initialize app when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  app.init();
});
