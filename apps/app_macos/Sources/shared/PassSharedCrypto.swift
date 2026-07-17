import CryptoKit
import Foundation

enum PassSharedCryptoError: Error, LocalizedError {
    case invalidCiphertext
    case keychainUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidCiphertext:
            return "本地数据无法解密"
        case .keychainUnavailable:
            return "无法读取本机加密密钥"
        }
    }
}

enum PassSharedCrypto {
    private static let keyService = "com.pass.desktop.shared.database"
    private static let keyAccount = "aes-gcm-key-v1"

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

    static func decrypt(_ data: Data) throws -> Data {
        guard data.first == 1 else {
            throw PassSharedCryptoError.invalidCiphertext
        }
        let sealed = try AES.GCM.SealedBox(combined: data.dropFirst())
        return try AES.GCM.open(sealed, using: loadOrCreateKey())
    }

    private static func loadOrCreateKey() throws -> SymmetricKey {
        let accessGroup = LocalKeychain.sharedAccessGroup()
        if let stored = LocalKeychain.read(
            service: keyService,
            account: keyAccount,
            accessGroup: accessGroup
        ), stored.count == 32 {
            return SymmetricKey(data: stored)
        }

        let key = SymmetricKey(size: .bits256)
        let rawKey = key.withUnsafeBytes { Data($0) }
        guard LocalKeychain.save(
            service: keyService,
            account: keyAccount,
            data: rawKey,
            accessGroup: accessGroup
        ) else {
            throw PassSharedCryptoError.keychainUnavailable
        }
        return key
    }
}

struct PassSyncEncryptedEnvelope: Codable {
    let schema: String
    let exportedAtMs: Int64
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

    static func isValidKeyString(_ value: String) -> Bool {
        normalizedKeyString(value).isEmpty
            || Data(base64URLString: normalizedKeyString(value))?.count == 32
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
            cipher: cipher,
            nonceBase64: Data(sealed.nonce).base64EncodedString(),
            ciphertextBase64: ciphertextAndTag.base64EncodedString()
        )
        return try JSONEncoder().encode(envelope)
    }

    static func decrypt(_ data: Data, keyString: String) throws -> Data {
        // 明文 bundle 直接返回
        if let probe = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let schemaValue = probe["schema"] as? String,
           schemaValue == plaintextSchema
        {
            return data
        }
        let key = normalizedKeyString(keyString)
        if key.isEmpty {
            throw NSError(
                domain: "PassSyncCrypto",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "该同步包为加密信封，但当前未配置同步加密密钥"]
            )
        }
        guard isValidKeyString(key) else {
            throw NSError(
                domain: "PassSyncCrypto",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "同步加密密钥无效，必须是 256 位密钥"]
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
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let ciphertext = combined.dropLast(16)
        let tag = combined.suffix(16)
        let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let symmetric = SymmetricKey(data: Data(base64URLString: key)!)
        return try AES.GCM.open(sealed, using: symmetric, authenticating: Data(schema.utf8))
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
