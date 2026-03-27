import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:crypto/crypto.dart';
import 'dart:convert';
import 'dart:io';

import '../models/models.dart';

class DatabaseService {
  Database? _database;
  final _secureStorage = const FlutterSecureStorage();
  String? _masterPasswordHash;

  Future<void> initialize() async {
    final directory = await getApplicationSupportDirectory();
    final path = join(directory.path, 'pass.db');

    _database = await openDatabase(
      path,
      version: 1,
      onCreate: _onCreate,
    );

    // Load master password hash from secure storage
    _masterPasswordHash = await _secureStorage.read(key: 'master_password_hash');
  }

  Future<void> _onCreate(Database db, int version) async {
    // Accounts table
    await db.execute('''
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        canonical_site TEXT NOT NULL,
        sites TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        totp_secret TEXT,
        recovery_codes TEXT,
        note TEXT,
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(folder_id) REFERENCES folders(id)
      )
    ''');

    // Folders table
    await db.execute('''
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        matched_sites TEXT NOT NULL,
        auto_add_matching INTEGER NOT NULL DEFAULT 0
      )
    ''');

    // Sync config table
    await db.execute('''
      CREATE TABLE sync_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        backend_type TEXT NOT NULL,
        server_url TEXT NOT NULL,
        username TEXT,
        password TEXT,
        bearer_token TEXT,
        auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
        auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 30
      )
    ''');

    // Create indexes
    await db.execute('CREATE INDEX idx_accounts_deleted ON accounts(deleted)');
    await db.execute('CREATE INDEX idx_accounts_folder ON accounts(folder_id)');
  }

  Future<void> unlock(String masterPassword) async {
    final hash = _hashPassword(masterPassword);

    if (_masterPasswordHash == null) {
      // First time - initialize with this password
      await _secureStorage.write(key: 'master_password_hash', value: hash);
      _masterPasswordHash = hash;
    } else if (hash != _masterPasswordHash) {
      throw Exception('Invalid master password');
    }
  }

  String _hashPassword(String password) {
    final bytes = utf8.encode(password);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  // Account operations
  Future<List<PasswordAccount>> getAllAccounts({bool includeDeleted = false}) async {
    if (_database == null) throw Exception('Database not initialized');

    final query = includeDeleted
        ? 'SELECT * FROM accounts ORDER BY updated_at DESC'
        : 'SELECT * FROM accounts WHERE deleted = 0 ORDER BY updated_at DESC';

    final results = await _database!.rawQuery(query);
    return results.map((json) => PasswordAccount.fromJson(json)).toList();
  }

  Future<PasswordAccount?> getAccountById(String accountId) async {
    if (_database == null) throw Exception('Database not initialized');

    final results = await _database!.query(
      'accounts',
      where: 'account_id = ?',
      whereArgs: [accountId],
    );

    if (results.isEmpty) return null;
    return PasswordAccount.fromJson(results.first);
  }

  Future<void> createAccount(PasswordAccount account) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.insert(
      'accounts',
      account.toJson(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> updateAccount(PasswordAccount account) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.update(
      'accounts',
      account.toJson(),
      where: 'account_id = ?',
      whereArgs: [account.accountId],
    );
  }

  Future<void> deleteAccount(String accountId) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.update(
      'accounts',
      {
        'deleted': 1,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'account_id = ?',
      whereArgs: [accountId],
    );
  }

  Future<void> restoreAccount(String accountId) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.update(
      'accounts',
      {
        'deleted': 0,
        'updated_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'account_id = ?',
      whereArgs: [accountId],
    );
  }

  Future<void> permanentlyDeleteAccount(String accountId) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.delete(
      'accounts',
      where: 'account_id = ?',
      whereArgs: [accountId],
    );
  }

  Future<List<PasswordAccount>> searchAccounts(String query) async {
    if (_database == null) throw Exception('Database not initialized');

    final searchPattern = '%$query%';
    final results = await _database!.rawQuery('''
      SELECT * FROM accounts
      WHERE deleted = 0 AND (
        username LIKE ? OR
        canonical_site LIKE ? OR
        sites LIKE ? OR
        note LIKE ?
      )
      ORDER BY updated_at DESC
    ''', [searchPattern, searchPattern, searchPattern, searchPattern]);

    return results.map((json) => PasswordAccount.fromJson(json)).toList();
  }

  // Folder operations
  Future<List<AccountFolder>> getAllFolders() async {
    if (_database == null) throw Exception('Database not initialized');

    final results = await _database!.query('folders', orderBy: 'name');
    return results.map((json) => AccountFolder.fromJson(json)).toList();
  }

  Future<void> createFolder(AccountFolder folder) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.insert(
      'folders',
      folder.toJson(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> updateFolder(AccountFolder folder) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.update(
      'folders',
      folder.toJson(),
      where: 'id = ?',
      whereArgs: [folder.id],
    );
  }

  Future<void> deleteFolder(String folderId) async {
    if (_database == null) throw Exception('Database not initialized');

    // Remove folder reference from accounts
    await _database!.update(
      'accounts',
      {'folder_id': null},
      where: 'folder_id = ?',
      whereArgs: [folderId],
    );

    await _database!.delete(
      'folders',
      where: 'id = ?',
      whereArgs: [folderId],
    );
  }

  // Sync config operations
  Future<SyncConfig?> getSyncConfig() async {
    if (_database == null) throw Exception('Database not initialized');

    final results = await _database!.query('sync_config', where: 'id = 1');
    if (results.isEmpty) return null;
    return SyncConfig.fromJson(results.first);
  }

  Future<void> saveSyncConfig(SyncConfig config) async {
    if (_database == null) throw Exception('Database not initialized');

    await _database!.insert(
      'sync_config',
      {'id': 1, ...config.toJson()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
