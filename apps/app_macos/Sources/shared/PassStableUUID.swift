import Foundation

/// Deterministic UUID generator matching the extension `stableUuidFromText` algorithm.
/// Used when decoding accounts that lack a valid `recordId` / `id`.
enum PassStableUUID {
    static func fromText(_ input: String) -> UUID {
        var seedParts: [UInt32] = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]
        let raw = Array(input.utf8)
        for (index, code) in raw.enumerated() {
            let idx = index % 4
            var value = seedParts[idx]
            value = UInt32(truncatingIfNeeded: UInt64(value) ^ UInt64(code))
            value = UInt32(truncatingIfNeeded: UInt64(value) &* 0x45d9f3b)
            value = value ^ (value >> 16)
            seedParts[idx] = value
        }
        let hex = seedParts
            .map { String(format: "%08x", $0) }
            .joined()
            .prefix(32)
        let chars = Array(hex)
        let formatted = "\(String(chars[0..<8]))-\(String(chars[8..<12]))-\(String(chars[12..<16]))-\(String(chars[16..<20]))-\(String(chars[20..<32]))"
        return UUID(uuidString: formatted) ?? UUID()
    }
}
