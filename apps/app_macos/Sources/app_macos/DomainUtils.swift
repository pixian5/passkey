import Foundation

enum DomainUtils {
    private static let secondLevelSuffixes = PassSyncPolicy.etld2Suffixes

    static func normalize(_ raw: String) -> String {
        var value = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if value.hasPrefix("http://") || value.hasPrefix("https://"),
           let host = URL(string: value)?.host(percentEncoded: false)
        {
            value = host
        }

        while value.hasSuffix(".") {
            value.removeLast()
        }

        return value
    }

    static func isIpHost(_ domain: String) -> Bool {
        let normalized = normalize(domain)
        guard !normalized.isEmpty else { return false }
        // IPv4
        let ipv4Parts = normalized.split(separator: ".", omittingEmptySubsequences: false)
        if ipv4Parts.count == 4 {
            return ipv4Parts.allSatisfy { part in
                guard !part.isEmpty, part.allSatisfy(\.isNumber), let value = Int(part) else {
                    return false
                }
                return (0...255).contains(value)
            }
        }
        // IPv6 (including compressed forms; brackets already stripped by normalize/URL host).
        if normalized.contains(":") {
            let allowed = CharacterSet(charactersIn: "0123456789abcdefABCDEF:")
            return normalized.unicodeScalars.allSatisfy { allowed.contains($0) }
        }
        return false
    }

    static func etldPlusOne(for domain: String) -> String {
        let normalized = normalize(domain)
        // Never collapse IP addresses to a shared tail (e.g. 192.168.1.1 / 10.0.1.1 → 1.1).
        if isIpHost(normalized) {
            return normalized
        }
        let labels = normalized.split(separator: ".").map(String.init)
        guard labels.count >= 2 else {
            return normalized
        }

        let joinedTail = labels.suffix(2).joined(separator: ".")
        if secondLevelSuffixes.contains(joinedTail), labels.count >= 3 {
            return labels.suffix(3).joined(separator: ".")
        }

        return labels.suffix(2).joined(separator: ".")
    }

    static func isSameSite(_ a: String, _ b: String) -> Bool {
        etldPlusOne(for: a) == etldPlusOne(for: b)
    }
}
