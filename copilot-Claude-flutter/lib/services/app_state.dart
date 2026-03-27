import 'package:flutter/foundation.dart';
import '../models/models.dart';
import 'database_service.dart';

class AppState extends ChangeNotifier {
  bool _isLocked = true;
  bool _isInitialized = false;
  List<PasswordAccount> _accounts = [];
  List<AccountFolder> _folders = [];
  String _currentView = 'all';
  String _searchQuery = '';

  bool get isLocked => _isLocked;
  bool get isInitialized => _isInitialized;
  List<PasswordAccount> get accounts => _accounts;
  List<AccountFolder> get folders => _folders;
  String get currentView => _currentView;
  String get searchQuery => _searchQuery;

  List<PasswordAccount> get filteredAccounts {
    var filtered = _accounts;

    // Apply view filter
    if (_currentView == 'totp') {
      filtered = filtered.where((a) => a.totpSecret != null).toList();
    } else if (_currentView == 'trash') {
      filtered = filtered.where((a) => a.deleted).toList();
    } else if (_currentView != 'all') {
      filtered = filtered.where((a) => a.folderId == _currentView).toList();
    } else {
      filtered = filtered.where((a) => !a.deleted).toList();
    }

    // Apply search filter
    if (_searchQuery.isNotEmpty) {
      final query = _searchQuery.toLowerCase();
      filtered = filtered.where((a) {
        return a.username.toLowerCase().contains(query) ||
            a.canonicalSite.toLowerCase().contains(query) ||
            a.sites.any((s) => s.toLowerCase().contains(query));
      }).toList();
    }

    return filtered;
  }

  Future<void> initialize(DatabaseService dbService) async {
    try {
      await dbService.initialize();
      _isInitialized = true;
      notifyListeners();
    } catch (e) {
      debugPrint('Error initializing app: $e');
    }
  }

  Future<void> unlock(DatabaseService dbService, String masterPassword) async {
    try {
      await dbService.unlock(masterPassword);
      _isLocked = false;
      await loadData(dbService);
      notifyListeners();
    } catch (e) {
      rethrow;
    }
  }

  void lock() {
    _isLocked = true;
    _accounts = [];
    _folders = [];
    notifyListeners();
  }

  Future<void> loadData(DatabaseService dbService) async {
    try {
      _accounts = await dbService.getAllAccounts(includeDeleted: _currentView == 'trash');
      _folders = await dbService.getAllFolders();
      notifyListeners();
    } catch (e) {
      debugPrint('Error loading data: $e');
    }
  }

  void setCurrentView(String view) {
    _currentView = view;
    notifyListeners();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  Future<void> createAccount(DatabaseService dbService, PasswordAccount account) async {
    await dbService.createAccount(account);
    await loadData(dbService);
  }

  Future<void> updateAccount(DatabaseService dbService, PasswordAccount account) async {
    await dbService.updateAccount(account);
    await loadData(dbService);
  }

  Future<void> deleteAccount(DatabaseService dbService, String accountId) async {
    await dbService.deleteAccount(accountId);
    await loadData(dbService);
  }

  Future<void> restoreAccount(DatabaseService dbService, String accountId) async {
    await dbService.restoreAccount(accountId);
    await loadData(dbService);
  }

  Future<void> permanentlyDeleteAccount(DatabaseService dbService, String accountId) async {
    await dbService.permanentlyDeleteAccount(accountId);
    await loadData(dbService);
  }

  Future<void> createFolder(DatabaseService dbService, AccountFolder folder) async {
    await dbService.createFolder(folder);
    await loadData(dbService);
  }

  Future<void> deleteFolder(DatabaseService dbService, String folderId) async {
    await dbService.deleteFolder(folderId);
    await loadData(dbService);
  }
}
