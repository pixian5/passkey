import Foundation

enum BrowserPasswordImportFormat: String {
    case chrome
    case firefox
    case generic

    var label: String {
        switch self {
        case .chrome:
            return "Chrome"
        case .firefox:
            return "Firefox"
        case .generic:
            return "浏览器 CSV"
        }
    }
}

enum BrowserPasswordExportFormat {
    case chrome
    case firefox

    var label: String {
        switch self {
        case .chrome:
            return "Chrome"
        case .firefox:
            return "Firefox"
        }
    }

    var fileNameToken: String {
        switch self {
        case .chrome:
            return "chrome"
        case .firefox:
            return "firefox"
        }
    }

    var headers: [String] {
        switch self {
        case .chrome:
            return ["name", "url", "username", "password", "note"]
        case .firefox:
            return ["url", "username", "password"]
        }
    }

    func row(site: String, username: String, password: String, note: String, canonicalSite: String) -> [String] {
        let normalizedSite = DomainUtils.normalize(site)
        let normalizedCanonical = DomainUtils.normalize(canonicalSite)
        let displayName = normalizedCanonical.isEmpty ? normalizedSite : normalizedCanonical
        let url = "https://\(normalizedSite)"

        switch self {
        case .chrome:
            return [displayName, url, username, password, note]
        case .firefox:
            return [url, username, password]
        }
    }
}

struct BrowserPasswordImportEntry {
    let sites: [String]
    let username: String
    let password: String
    let note: String
}

struct BrowserPasswordImportResult {
    let format: BrowserPasswordImportFormat
    let entries: [BrowserPasswordImportEntry]
    let skippedRowCount: Int
}

enum BrowserPasswordImportError: LocalizedError {
    case emptyFile
    case missingHeader
    case unsupportedHeader

    var errorDescription: String? {
        switch self {
        case .emptyFile:
            return "文件内容为空"
        case .missingHeader:
            return "CSV 缺少表头"
        case .unsupportedHeader:
            return "无法识别为 Chrome 或 Firefox 导出的密码 CSV"
        }
    }
}

enum BrowserPasswordImportParser {
    static func parse(data: Data) throws -> BrowserPasswordImportResult {
        let utf8Text = String(decoding: data, as: UTF8.self)
        let normalizedText = utf8Text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedText.isEmpty else {
            throw BrowserPasswordImportError.emptyFile
        }

        let rows = parseCsvRows(normalizedText)
        guard let rawHeader = rows.first, !rawHeader.isEmpty else {
            throw BrowserPasswordImportError.missingHeader
        }

        let headers = rawHeader.map(normalizeHeader)
        let format = detectFormat(headers: headers)
        guard format != nil else {
            throw BrowserPasswordImportError.unsupportedHeader
        }

        var entries: [BrowserPasswordImportEntry] = []
        var skippedRowCount = 0

        for row in rows.dropFirst() {
            let entry = parseEntry(row: row, headers: headers)
            if let entry {
                entries.append(entry)
            } else if !row.joined().trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                skippedRowCount += 1
            }
        }

        return BrowserPasswordImportResult(
            format: format ?? .generic,
            entries: entries,
            skippedRowCount: skippedRowCount
        )
    }

    private static func detectFormat(headers: [String]) -> BrowserPasswordImportFormat? {
        let headerSet = Set(headers)
        if headerSet.contains("url"), headerSet.contains("username"), headerSet.contains("password") {
            if headerSet.contains("name") || headerSet.contains("note") || headerSet.contains("notes") {
                return .chrome
            }
            if headerSet.contains("httprealm") || headerSet.contains("formactionorigin") || headerSet.contains("guid") {
                return .firefox
            }
            return .generic
        }
        if headerSet.contains("origin"), headerSet.contains("username"), headerSet.contains("password") {
            return .chrome
        }
        if headerSet.contains("signon_realm"), headerSet.contains("username"), headerSet.contains("password") {
            return .chrome
        }
        return nil
    }

    private static func parseEntry(row: [String], headers: [String]) -> BrowserPasswordImportEntry? {
        let values = Dictionary(uniqueKeysWithValues: headers.enumerated().map { index, header in
            let value = index < row.count ? row[index] : ""
            return (header, value.trimmingCharacters(in: .whitespacesAndNewlines))
        })

        let sites = extractSites(values: values)
        let username = normalizedValue(values["username"])
        let password = normalizedValue(values["password"])

        guard !sites.isEmpty, !username.isEmpty || !password.isEmpty else {
            return nil
        }

        let noteParts = [
            labeledNote(label: "来源名称", value: values["name"]),
            labeledNote(label: "备注", value: values["note"] ?? values["notes"]),
            labeledNote(label: "HTTP Realm", value: values["httprealm"]),
        ].compactMap { $0 }

        return BrowserPasswordImportEntry(
            sites: sites,
            username: username,
            password: password,
            note: uniqueLines(noteParts).joined(separator: "\n")
        )
    }

    private static func extractSites(values: [String: String]) -> [String] {
        let rawCandidates = [
            values["url"],
            values["origin"],
            values["website"],
            values["hostname"],
            values["signon_realm"],
            values["formactionorigin"],
            values["action"],
        ]

        let normalized = rawCandidates
            .compactMap { normalizedSite(from: $0) }
        return Array(Set(normalized)).sorted()
    }

    private static func normalizedSite(from value: String?) -> String? {
        let raw = normalizedValue(value)
        guard !raw.isEmpty else { return nil }

        if raw.contains("://"), let host = URL(string: raw)?.host {
            let normalized = DomainUtils.normalize(host)
            return normalized.isEmpty ? nil : normalized
        }

        let normalized = DomainUtils.normalize(raw)
        return normalized.isEmpty ? nil : normalized
    }

    private static func labeledNote(label: String, value: String?) -> String? {
        let normalized = normalizedValue(value)
        guard !normalized.isEmpty else { return nil }
        return "\(label)：\(normalized)"
    }

    private static func normalizedValue(_ value: String?) -> String {
        guard let value else { return "" }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func uniqueLines(_ input: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for item in input {
            if seen.insert(item).inserted {
                result.append(item)
            }
        }
        return result
    }

    private static func normalizeHeader(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\u{feff}", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "_")
    }

    private static func parseCsvRows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var isInsideQuotes = false

        let characters = Array(text)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if isInsideQuotes {
                if character == "\"" {
                    let nextIndex = index + 1
                    if nextIndex < characters.count, characters[nextIndex] == "\"" {
                        field.append("\"")
                        index = nextIndex
                    } else {
                        isInsideQuotes = false
                    }
                } else {
                    field.append(character)
                }
            } else {
                switch character {
                case "\"":
                    isInsideQuotes = true
                case ",":
                    row.append(field)
                    field = ""
                case "\n":
                    row.append(field)
                    rows.append(row)
                    row = []
                    field = ""
                default:
                    field.append(character)
                }
            }
            index += 1
        }

        if !field.isEmpty || !row.isEmpty {
            row.append(field)
            rows.append(row)
        }

        return rows.filter { !$0.isEmpty }
    }
}
