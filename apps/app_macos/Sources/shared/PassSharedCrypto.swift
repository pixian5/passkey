import CryptoKit
import Foundation

enum PassSharedCryptoError: Error, LocalizedError {
    case invalidCiphertext
    case localKeyUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidCiphertext:
            return "本地数据无法解密"
        case .localKeyUnavailable:
            return "无法读取本地加密密钥"
        }
    }
}

enum PassSharedCrypto {
    private static let keyService = "com.pass.desktop.shared.database"
    private static let keyAccount = "aes-gcm-key-v1"
    private static let keyFileName = "pass-db-key-v1"

    static func encrypt(_ data: Data) throws -> Data {
        let sealed = try AES.GCM.seal(data, using: try loadOrCreateKey())
        guard let combined = sealed.combined else {
            throw PassSharedCryptoError.invalidCiphertext
        }
        return Data([1]) + combined
    }

    static func isEncrypted(_ data: Data) -> Bool {
        data.first == 1
    }

    /// Loads the key before SQLite creates a new database file. This preserves
    /// the distinction between a genuinely new store and an existing store
    /// whose key is unavailable.
    static func ensureKeyAvailable() throws {
        _ = try loadOrCreateKey()
    }

    static func encryptLocalSecret(_ data: Data) throws -> Data {
        let sealed = try AES.GCM.seal(data, using: try loadOrCreateKey(), authenticating: Data("pass.local.secret.v1".utf8))
        guard let combined = sealed.combined else { throw PassSharedCryptoError.invalidCiphertext }
        return Data([1]) + combined
    }

    static func decryptLocalSecret(_ data: Data) throws -> Data {
        guard data.first == 1 else { throw PassSharedCryptoError.invalidCiphertext }
        let sealed = try AES.GCM.SealedBox(combined: data.dropFirst())
        return try AES.GCM.open(sealed, using: loadOrCreateKey(), authenticating: Data("pass.local.secret.v1".utf8))
    }

    static func decrypt(_ data: Data) throws -> Data {
        guard data.first == 1 else {
            throw PassSharedCryptoError.invalidCiphertext
        }
        let sealed = try AES.GCM.SealedBox(combined: data.dropFirst())
        return try AES.GCM.open(sealed, using: loadOrCreateKey())
    }

    private static func loadOrCreateKey() throws -> SymmetricKey {
        let databaseURL = PassSharedData.databaseURL()
        if let stored = PassSharedFileSecretStore.read(named: keyFileName) {
            guard stored.count == 32 else {
                throw PassSharedCryptoError.localKeyUnavailable
            }
            return SymmetricKey(data: stored)
        }

        // Migrate an existing database key once. The migration read is
        // explicitly non-interactive; failure must never create a replacement
        // key for an existing database because that would make all data
        // undecryptable.
        if let stored = LocalKeychain.read(
            service: keyService,
            account: keyAccount
        ), stored.count == 32 {
            guard PassSharedFileSecretStore.write(stored, named: keyFileName) else {
                throw PassSharedCryptoError.localKeyUnavailable
            }
            return SymmetricKey(data: stored)
        }

        let databaseExists = FileManager.default.fileExists(atPath: databaseURL.path)
            || FileManager.default.fileExists(atPath: databaseURL.deletingLastPathComponent()
                .appendingPathComponent(databaseURL.lastPathComponent + "-wal").path)
            || FileManager.default.fileExists(atPath: databaseURL.deletingLastPathComponent()
                .appendingPathComponent(databaseURL.lastPathComponent + "-shm").path)
        guard !databaseExists else {
            throw PassSharedCryptoError.localKeyUnavailable
        }

        let key = SymmetricKey(size: .bits256)
        let rawKey = key.withUnsafeBytes { Data($0) }
        guard PassSharedFileSecretStore.write(rawKey, named: keyFileName) else {
            throw PassSharedCryptoError.localKeyUnavailable
        }
        return key
    }
}

struct PassSyncEncryptedEnvelope: Codable {
    let schema: String
    let exportedAtMs: Int64
    let keyId: String?
    let cipher: String
    let nonceBase64: String
    let ciphertextBase64: String
}

enum PassSyncCrypto {
    static let schema = "pass.sync.encrypted.v1"
    static let plaintextSchema = "pass.sync.bundle.v2"
    private static let cipher = "AES-256-GCM"

    static func generateKeyString() -> String {
        let key = SymmetricKey(size: .bits256)
        return key.withUnsafeBytes { Data($0) }.base64URLEncodedString()
    }

    static func normalizedKeyString(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isEncryptionEnabled(_ value: String) -> Bool {
        isValidKeyString(value)
    }

    static func isEncryptionKeyConfigured(_ value: String) -> Bool {
        let normalized = normalizedKeyString(value)
        return !normalized.isEmpty && isValidKeyString(normalized)
    }

    static func isValidKeyString(_ value: String) -> Bool {
        normalizedKeyString(value).isEmpty
            || Data(base64URLString: normalizedKeyString(value))?.count == 32
    }

    static func keyId(for keyString: String) -> String {
        let normalized = normalizedKeyString(keyString)
        guard let keyData = Data(base64URLString: normalized), keyData.count == 32 else { return "" }
        let digest = SHA256.hash(data: keyData)
        let prefix = digest.prefix(8).map { String(format: "%02x", $0) }.joined()
        return "k1-\(prefix)"
    }

    static func encrypt(_ plaintext: Data, keyString: String, exportedAtMs: Int64) throws -> Data {
        let key = normalizedKeyString(keyString)
        if key.isEmpty {
            return plaintext
        }
        guard isValidKeyString(key) else {
            throw NSError(
                domain: "PassSyncCrypto",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "同步加密密钥无效，必须是 256 位密钥"]
            )
        }
        let symmetric = SymmetricKey(data: Data(base64URLString: key)!)
        let sealed = try AES.GCM.seal(plaintext, using: symmetric, authenticating: Data(schema.utf8))
        let ciphertextAndTag = sealed.ciphertext + sealed.tag
        let envelope = PassSyncEncryptedEnvelope(
            schema: schema,
            exportedAtMs: exportedAtMs,
            keyId: keyId(for: key),
            cipher: cipher,
            nonceBase64: Data(sealed.nonce).base64EncodedString(),
            ciphertextBase64: ciphertextAndTag.base64EncodedString()
        )
        return try JSONEncoder().encode(envelope)
    }

    static func decrypt(_ data: Data, keyString: String, fallbackKeyStrings: [String] = []) throws -> Data {
        // 明文 bundle 直接返回
        if let probe = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let schemaValue = probe["schema"] as? String,
           schemaValue == plaintextSchema
        {
            return data
        }
        var candidateKeys: [String] = []
        for candidate in [keyString] + fallbackKeyStrings {
            let normalized = normalizedKeyString(candidate)
            guard !normalized.isEmpty, isValidKeyString(normalized), !candidateKeys.contains(normalized) else {
                continue
            }
            candidateKeys.append(normalized)
        }
        if candidateKeys.isEmpty {
            throw NSError(
                domain: "PassSyncCrypto",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "该同步包为加密信封，但当前未配置同步加密密钥"]
            )
        }
        let envelope = try JSONDecoder().decode(PassSyncEncryptedEnvelope.self, from: data)
        guard envelope.schema == schema, envelope.cipher == cipher,
              let nonceData = Data(base64Encoded: envelope.nonceBase64),
              let combined = Data(base64Encoded: envelope.ciphertextBase64),
              combined.count > 16
        else {
            throw PassSharedCryptoError.invalidCiphertext
        }
        let declaredKeyId = envelope.keyId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let matchingKeys = declaredKeyId.isEmpty
            ? candidateKeys
            : candidateKeys.filter { keyId(for: $0) == declaredKeyId }
        guard !matchingKeys.isEmpty else {
            throw NSError(
                domain: "PassSyncCrypto",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "同步密钥 ID 不匹配，请选择与远端数据相同的同步密钥或完成密钥轮换"]
            )
        }
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let ciphertext = combined.dropLast(16)
        let tag = combined.suffix(16)
        let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        for key in matchingKeys {
            let symmetric = SymmetricKey(data: Data(base64URLString: key)!)
            if let plaintext = try? AES.GCM.open(sealed, using: symmetric, authenticating: Data(schema.utf8)) {
                return plaintext
            }
        }
        throw PassSharedCryptoError.invalidCiphertext
    }
}

private extension Data {
    init?(base64URLString: String) {
        var normalized = base64URLString
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        self.init(base64Encoded: normalized)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
