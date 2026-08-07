class PasswordAccount {
  final String id;
  final String accountId;
  final String canonicalSite;
  final List<String> sites;
  final String username;
  final String password;
  final String? totpSecret;
  final String? recoveryCodes;
  final String? note;
  final String? folderId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool deleted;

  PasswordAccount({
    required this.id,
    required this.accountId,
    required this.canonicalSite,
    required this.sites,
    required this.username,
    required this.password,
    this.totpSecret,
    this.recoveryCodes,
    this.note,
    this.folderId,
    required this.createdAt,
    required this.updatedAt,
    this.deleted = false,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'account_id': accountId,
      'canonical_site': canonicalSite,
      'sites': sites,
      'username': username,
      'password': password,
      'totp_secret': totpSecret,
      'recovery_codes': recoveryCodes,
      'note': note,
      'folder_id': folderId,
      'created_at': createdAt.millisecondsSinceEpoch,
      'updated_at': updatedAt.millisecondsSinceEpoch,
      'deleted': deleted ? 1 : 0,
    };
  }

  factory PasswordAccount.fromJson(Map<String, dynamic> json) {
    return PasswordAccount(
      id: json['id'] as String,
      accountId: json['account_id'] as String,
      canonicalSite: json['canonical_site'] as String,
      sites: (json['sites'] as String).split(','),
      username: json['username'] as String,
      password: json['password'] as String,
      totpSecret: json['totp_secret'] as String?,
      recoveryCodes: json['recovery_codes'] as String?,
      note: json['note'] as String?,
      folderId: json['folder_id'] as String?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(json['created_at'] as int),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(json['updated_at'] as int),
      deleted: (json['deleted'] as int) == 1,
    );
  }

  PasswordAccount copyWith({
    String? id,
    String? accountId,
    String? canonicalSite,
    List<String>? sites,
    String? username,
    String? password,
    String? totpSecret,
    String? recoveryCodes,
    String? note,
    String? folderId,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? deleted,
  }) {
    return PasswordAccount(
      id: id ?? this.id,
      accountId: accountId ?? this.accountId,
      canonicalSite: canonicalSite ?? this.canonicalSite,
      sites: sites ?? this.sites,
      username: username ?? this.username,
      password: password ?? this.password,
      totpSecret: totpSecret ?? this.totpSecret,
      recoveryCodes: recoveryCodes ?? this.recoveryCodes,
      note: note ?? this.note,
      folderId: folderId ?? this.folderId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      deleted: deleted ?? this.deleted,
    );
  }
}

class AccountFolder {
  final String id;
  final String name;
  final List<String> matchedSites;
  final bool autoAddMatching;

  AccountFolder({
    required this.id,
    required this.name,
    required this.matchedSites,
    this.autoAddMatching = false,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'matched_sites': matchedSites.join(','),
      'auto_add_matching': autoAddMatching ? 1 : 0,
    };
  }

  factory AccountFolder.fromJson(Map<String, dynamic> json) {
    return AccountFolder(
      id: json['id'] as String,
      name: json['name'] as String,
      matchedSites: (json['matched_sites'] as String).split(','),
      autoAddMatching: (json['auto_add_matching'] as int) == 1,
    );
  }
}

class SyncConfig {
  final String backendType; // 'webdav' or 'self-hosted'
  final String serverUrl;
  final String? username;
  final String? password;
  final String? bearerToken;
  final bool autoSyncEnabled;
  final int autoSyncIntervalMinutes;

  SyncConfig({
    required this.backendType,
    required this.serverUrl,
    this.username,
    this.password,
    this.bearerToken,
    this.autoSyncEnabled = false,
    this.autoSyncIntervalMinutes = 30,
  });

  Map<String, dynamic> toJson() {
    return {
      'backend_type': backendType,
      'server_url': serverUrl,
      'username': username,
      'password': password,
      'bearer_token': bearerToken,
      'auto_sync_enabled': autoSyncEnabled ? 1 : 0,
      'auto_sync_interval_minutes': autoSyncIntervalMinutes,
    };
  }

  factory SyncConfig.fromJson(Map<String, dynamic> json) {
    return SyncConfig(
      backendType: json['backend_type'] as String,
      serverUrl: json['server_url'] as String,
      username: json['username'] as String?,
      password: json['password'] as String?,
      bearerToken: json['bearer_token'] as String?,
      autoSyncEnabled: (json['auto_sync_enabled'] as int) == 1,
      autoSyncIntervalMinutes: json['auto_sync_interval_minutes'] as int,
    );
  }
}
