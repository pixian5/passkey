import Foundation
import LocalAuthentication

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let context = LAContext()
context.localizedFallbackTitle = "输入主密码"
var availabilityError: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &availabilityError) else {
    fail(availabilityError?.localizedDescription ?? "当前设备不支持 Touch ID")
}

let semaphore = DispatchSemaphore(value: 0)
var authenticated = false
var evaluationError: Error?
context.evaluatePolicy(
    .deviceOwnerAuthenticationWithBiometrics,
    localizedReason: "解锁 Pass Desktop"
) { success, error in
    authenticated = success
    evaluationError = error
    semaphore.signal()
}
semaphore.wait()

guard authenticated else {
    fail(evaluationError?.localizedDescription ?? "Touch ID 验证失败")
}
