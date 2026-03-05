import Foundation

enum DomainUtils {
    private static let secondLevelSuffixes: Set<String> = [
        "com.cn",
        "net.cn",
        "org.cn",
        "gov.cn",
        "edu.cn",
        "co.uk",
        "org.uk",
    ]

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

    static func etldPlusOne(for domain: String) -> String {
        let normalized = normalize(domain)
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

