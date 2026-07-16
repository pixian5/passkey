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
