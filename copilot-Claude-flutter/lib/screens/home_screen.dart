import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';
import '../services/app_state.dart';
import '../services/database_service.dart';
import '../services/sync_service.dart';
import '../models/models.dart';
import '../widgets/account_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showAccountDialog({PasswordAccount? account}) {
    showDialog(
      context: context,
      builder: (context) => AccountDialog(account: account),
    );
  }

  Future<void> _sync() async {
    try {
      final dbService = Provider.of<DatabaseService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);
      final appState = Provider.of<AppState>(context, listen: false);

      final config = await dbService.getSyncConfig();
      if (config == null) {
        _showMessage('Sync not configured');
        return;
      }

      final accounts = await dbService.getAllAccounts();
      await syncService.syncWithServer(config, accounts);

      await appState.loadData(dbService);
      _showMessage('Synced successfully');
    } catch (e) {
      _showMessage('Sync failed: $e');
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AppState>(
      builder: (context, appState, child) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Pass - Password Manager'),
            actions: [
              IconButton(
                icon: const Icon(Icons.sync),
                tooltip: 'Sync',
                onPressed: _sync,
              ),
              IconButton(
                icon: const Icon(Icons.lock),
                tooltip: 'Lock',
                onPressed: () => appState.lock(),
              ),
            ],
          ),
          body: Row(
            children: [
              // Sidebar
              NavigationRail(
                extended: true,
                selectedIndex: _getSelectedIndex(appState.currentView),
                onDestinationSelected: (index) {
                  setState(() {
                    switch (index) {
                      case 0:
                        appState.setCurrentView('all');
                        break;
                      case 1:
                        appState.setCurrentView('totp');
                        break;
                      case 2:
                        appState.setCurrentView('trash');
                        break;
                    }
                  });
                },
                destinations: const [
                  NavigationRailDestination(
                    icon: Icon(Icons.list),
                    label: Text('All Accounts'),
                  ),
                  NavigationRailDestination(
                    icon: Icon(Icons.security),
                    label: Text('TOTP'),
                  ),
                  NavigationRailDestination(
                    icon: Icon(Icons.delete),
                    label: Text('Trash'),
                  ),
                ],
              ),
              const VerticalDivider(thickness: 1, width: 1),

              // Main content
              Expanded(
                child: Column(
                  children: [
                    // Search bar
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          FilledButton.icon(
                            onPressed: () => _showAccountDialog(),
                            icon: const Icon(Icons.add),
                            label: const Text('New Account'),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: TextField(
                              controller: _searchController,
                              decoration: const InputDecoration(
                                hintText: 'Search accounts...',
                                prefixIcon: Icon(Icons.search),
                                border: OutlineInputBorder(),
                                contentPadding: EdgeInsets.symmetric(horizontal: 16),
                              ),
                              onChanged: (value) => appState.setSearchQuery(value),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Accounts grid
                    Expanded(
                      child: _buildAccountsGrid(appState),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  int _getSelectedIndex(String view) {
    switch (view) {
      case 'all':
        return 0;
      case 'totp':
        return 1;
      case 'trash':
        return 2;
      default:
        return 0;
    }
  }

  Widget _buildAccountsGrid(AppState appState) {
    final accounts = appState.filteredAccounts;

    if (accounts.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inbox_outlined, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              'No accounts found',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            const Text('Click "New Account" to add your first password'),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 350,
        childAspectRatio: 1.5,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
      ),
      itemCount: accounts.length,
      itemBuilder: (context, index) {
        final account = accounts[index];
        return AccountCard(
          account: account,
          onTap: () => _showAccountDialog(account: account),
        );
      },
    );
  }
}

class AccountDialog extends StatefulWidget {
  final PasswordAccount? account;

  const AccountDialog({super.key, this.account});

  @override
  State<AccountDialog> createState() => _AccountDialogState();
}

class _AccountDialogState extends State<AccountDialog> {
  late final TextEditingController _siteController;
  late final TextEditingController _usernameController;
  late final TextEditingController _passwordController;
  late final TextEditingController _totpController;
  late final TextEditingController _noteController;

  @override
  void initState() {
    super.initState();
    _siteController = TextEditingController(text: widget.account?.canonicalSite ?? '');
    _usernameController = TextEditingController(text: widget.account?.username ?? '');
    _passwordController = TextEditingController(text: widget.account?.password ?? '');
    _totpController = TextEditingController(text: widget.account?.totpSecret ?? '');
    _noteController = TextEditingController(text: widget.account?.note ?? '');
  }

  @override
  void dispose() {
    _siteController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _totpController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final appState = Provider.of<AppState>(context, listen: false);
    final dbService = Provider.of<DatabaseService>(context, listen: false);

    final now = DateTime.now();
    final account = PasswordAccount(
      id: widget.account?.id ?? const Uuid().v4(),
      accountId: widget.account?.accountId ?? const Uuid().v4(),
      canonicalSite: _siteController.text,
      sites: [_siteController.text],
      username: _usernameController.text,
      password: _passwordController.text,
      totpSecret: _totpController.text.isEmpty ? null : _totpController.text,
      note: _noteController.text.isEmpty ? null : _noteController.text,
      createdAt: widget.account?.createdAt ?? now,
      updatedAt: now,
    );

    if (widget.account == null) {
      await appState.createAccount(dbService, account);
    } else {
      await appState.updateAccount(dbService, account);
    }

    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.account == null ? 'New Account' : 'Edit Account'),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _siteController,
                decoration: const InputDecoration(
                  labelText: 'Website / Service',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _usernameController,
                decoration: const InputDecoration(
                  labelText: 'Username',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Password',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _totpController,
                decoration: const InputDecoration(
                  labelText: 'TOTP Secret (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _noteController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Notes (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
