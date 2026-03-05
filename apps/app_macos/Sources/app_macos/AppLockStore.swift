import AppKit
import CryptoKit
import Foundation
import LocalAuthentication

enum AppLockPolicy: String, CaseIterable, Identifiable {
    case onceUntilQuit
    case idleTimeout
    case onBackground

    var id: String { rawValue }

    var title: String {
        switch self {
        case .onceUntilQuit:
            return "解锁一次到关闭前"
        case .idleTimeout:
            return "几分钟无操作后锁定"
        case .onBackground:
            return "移到后台锁定"
        }
    }
}

@MainActor
final class AppLockStore: ObservableObject {
    @Published private(set) var isUnlockEnabled: Bool
    @Published private(set) var isLocked: Bool
    @Published private(set) var lockMessage: String = ""
    @Published private(set) var settingsMessage: String = ""
    @Published var unlockPasswordInput: String = ""
    @Published var preferBiometrics: Bool {
        didSet {
            persistPreferences()
        }
    }
    @Published var lockPolicy: AppLockPolicy {
        didSet {
            persistPreferences()
        }
    }
    @Published var idleLockMinutes: Int {
        didSet {
            let clamped = min(max(idleLockMinutes, 1), 60)
            if clamped != idleLockMinutes {
                idleLockMinutes = clamped
                return
            }
            persistPreferences()
        }
    }

    private var lastActivityAt: Date = Date()
    private var hasAttemptedBiometricForCurrentLock: Bool = false
    private var localEventMonitor: Any?

    init() {
        let defaults = UserDefaults.standard
        let savedPolicy = defaults.string(forKey: AppLockKeys.lockPolicy)
        let savedMinutes = defaults.integer(forKey: AppLockKeys.idleLockMinutes)
        let enabled = defaults.bool(forKey: AppLockKeys.isUnlockEnabled)

        isUnlockEnabled = enabled
        isLocked = enabled
        preferBiometrics = defaults.object(forKey: AppLockKeys.preferBiometrics) as? Bool ?? true
        lockPolicy = AppLockPolicy(rawValue: savedPolicy ?? "") ?? .onceUntilQuit
        idleLockMinutes = savedMinutes > 0 ? savedMinutes : 5
        installActivityMonitor()
    }

    var shouldShowLockScreen: Bool {
        isUnlockEnabled && isLocked
    }

    func enableUnlock(newPassword: String, confirmPassword: String) {
        let password = newPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        let confirm = confirmPassword.trimmingCharacters(in: .whitespacesAndNewlines)

        guard password.count >= 4 else {
            settingsMessage = "主密码至少需要 4 位"
            return
        }
        guard password == confirm else {
            settingsMessage = "两次输入的主密码不一致"
            return
        }
        guard storeMasterPassword(password) else {
            settingsMessage = "保存主密码失败"
            return
        }

        isUnlockEnabled = true
        UserDefaults.standard.set(true, forKey: AppLockKeys.isUnlockEnabled)
        persistPreferences()
        settingsMessage = "应用解锁已启用"
    }

    func disableUnlock(currentPassword: String) {
        guard verifyPassword(currentPassword) else {
            settingsMessage = "主密码错误，无法关闭解锁"
            return
        }

        isUnlockEnabled = false
        isLocked = false
        lockMessage = ""
        unlockPasswordInput = ""
        UserDefaults.standard.set(false, forKey: AppLockKeys.isUnlockEnabled)
        settingsMessage = "应用解锁已关闭"
    }

    func lock(reason: String) {
        guard isUnlockEnabled else { return }
        guard !isLocked else { return }
        isLocked = true
        lockMessage = reason
        unlockPasswordInput = ""
        hasAttemptedBiometricForCurrentLock = false
    }

    func unlockWithPassword() {
        guard isUnlockEnabled else { return }
        guard verifyPassword(unlockPasswordInput) else {
            lockMessage = "主密码错误"
            return
        }
        finishUnlock()
    }

    func tryBiometricUnlock() {
        guard isUnlockEnabled else { return }
        let context = LAContext()
        context.localizedFallbackTitle = "输入主密码"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            lockMessage = "当前设备不支持指纹解锁"
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "解锁 Pass Mac"
        ) { success, authError in
            Task { @MainActor in
                if success {
                    self.finishUnlock()
                    return
                }
                self.lockMessage = authError?.localizedDescription ?? "指纹解锁失败"
            }
        }
    }

    func autoTryBiometricIfNeeded() {
        guard shouldShowLockScreen else { return }
        guard preferBiometrics else { return }
        guard !hasAttemptedBiometricForCurrentLock else { return }
        hasAttemptedBiometricForCurrentLock = true
        tryBiometricUnlock()
    }

    func checkAutoLock(at now: Date = Date()) {
        guard isUnlockEnabled else { return }
        guard !isLocked else { return }

        if lockPolicy == .idleTimeout {
            let idleSeconds = now.timeIntervalSince(lastActivityAt)
            if idleSeconds >= TimeInterval(idleLockMinutes * 60) {
                lock(reason: "超过 \(idleLockMinutes) 分钟无操作，已锁定")
            }
        }
    }

    func handleAppWillResignActive() {
        guard isUnlockEnabled else { return }
        guard !isLocked else { return }
        guard lockPolicy == .onBackground else { return }
        lock(reason: "应用移到后台，已锁定")
    }

    func registerUserActivity() {
        guard isUnlockEnabled else { return }
        guard !isLocked else { return }
        lastActivityAt = Date()
    }

    private func finishUnlock() {
        isLocked = false
        lockMessage = ""
        unlockPasswordInput = ""
        hasAttemptedBiometricForCurrentLock = false
        lastActivityAt = Date()
    }

    private func persistPreferences() {
        let defaults = UserDefaults.standard
        defaults.set(preferBiometrics, forKey: AppLockKeys.preferBiometrics)
        defaults.set(lockPolicy.rawValue, forKey: AppLockKeys.lockPolicy)
        defaults.set(idleLockMinutes, forKey: AppLockKeys.idleLockMinutes)
    }

    private func storeMasterPassword(_ password: String) -> Bool {
        let salt = Data((0..<16).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
        let digest = passwordDigest(password: password, salt: salt)
        let credential = MasterPasswordCredential(
            version: 1,
            saltBase64: salt.base64EncodedString(),
            digestBase64: digest
        )
        guard let encoded = try? JSONEncoder().encode(credential) else {
            return false
        }
        let saved = LocalKeychain.save(
            service: AppLockKeys.keychainService,
            account: AppLockKeys.keychainAccount,
            data: encoded
        )
        if saved {
            let defaults = UserDefaults.standard
            defaults.removeObject(forKey: AppLockKeys.masterPasswordSalt)
            defaults.removeObject(forKey: AppLockKeys.masterPasswordDigest)
        }
        return saved
    }

    private func verifyPassword(_ password: String) -> Bool {
        if let credential = loadMasterCredential(),
           let salt = Data(base64Encoded: credential.saltBase64) {
            let candidate = passwordDigest(password: password, salt: salt)
            return candidate == credential.digestBase64
        }

        let defaults = UserDefaults.standard
        guard let saltBase64 = defaults.string(forKey: AppLockKeys.masterPasswordSalt),
              let digest = defaults.string(forKey: AppLockKeys.masterPasswordDigest),
              let salt = Data(base64Encoded: saltBase64)
        else {
            return false
        }

        let candidate = passwordDigest(password: password, salt: salt)
        return candidate == digest
    }

    private func passwordDigest(password: String, salt: Data) -> String {
        var source = Data()
        source.append(salt)
        source.append(Data(password.utf8))
        let hash = SHA256.hash(data: source)
        return Data(hash).base64EncodedString()
    }

    private func installActivityMonitor() {
        localEventMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [
                .leftMouseDown,
                .rightMouseDown,
                .otherMouseDown,
                .mouseMoved,
                .keyDown,
                .scrollWheel,
            ]
        ) { [weak self] event in
            Task { @MainActor in
                self?.registerUserActivity()
            }
            return event
        }
    }

    private func loadMasterCredential() -> MasterPasswordCredential? {
        guard let encoded = LocalKeychain.read(
            service: AppLockKeys.keychainService,
            account: AppLockKeys.keychainAccount
        ) else {
            return nil
        }
        return try? JSONDecoder().decode(MasterPasswordCredential.self, from: encoded)
    }

}

private enum AppLockKeys {
    static let isUnlockEnabled = "pass.lock.enabled"
    static let preferBiometrics = "pass.lock.preferBiometrics"
    static let lockPolicy = "pass.lock.policy"
    static let idleLockMinutes = "pass.lock.idleMinutes"

    static let keychainService = "com.pass.desktop"
    static let keychainAccount = "app_lock.master_password.v1"

    // legacy keys kept for one-time migration
    static let masterPasswordSalt = "pass.lock.password.salt"
    static let masterPasswordDigest = "pass.lock.password.digest"
}

private struct MasterPasswordCredential: Codable {
    let version: Int
    let saltBase64: String
    let digestBase64: String
}
