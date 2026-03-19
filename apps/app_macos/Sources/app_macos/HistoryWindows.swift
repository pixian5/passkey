import SwiftUI

struct HistoryWindowView: View {
    @ObservedObject var store: AccountStore
    let category: HistoryEntryCategory
    @Environment(\.dismiss) private var dismiss

    private var groupedOperations: [HistoryOperationGroup] {
        let entries = store.historyEntries(category: category)
        let grouped = Dictionary(grouping: entries, by: \.operationId)
        return grouped.values
            .map(HistoryOperationGroup.init(entries:))
            .sorted { lhs, rhs in
                if lhs.timestampMs != rhs.timestampMs {
                    return lhs.timestampMs > rhs.timestampMs
                }
                return lhs.id.uuidString < rhs.id.uuidString
            }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(category.menuTitle)
                    .font(store.textFont(size: store.scaledTextSize(18), weight: .semibold))
                Spacer()
                Button("清空") {
                    store.clearHistoryEntries(category: category)
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
                .disabled(groupedOperations.isEmpty)
                Button("关闭") {
                    dismiss()
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }

            if groupedOperations.isEmpty {
                Text("暂无\(category.menuTitle)")
                    .font(store.textFont(size: store.scaledTextSize(17)))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(groupedOperations) { group in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(alignment: .top, spacing: 8) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(group.title)
                                            .font(store.textFont(size: store.scaledTextSize(15), weight: .semibold))
                                        Text("\(store.displayTime(group.timestampMs)) · \(group.entries.count) 个账号")
                                            .font(store.textFont(size: store.scaledTextSize(11)))
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button("撤销此次操作") {
                                        store.revertHistoryOperation(group.entries)
                                    }
                                    .font(store.buttonFont(size: max(12, CGFloat(store.uiButtonFontSize - 2))))
                                    .buttonStyle(.borderedProminent)
                                    .disabled(!store.canRevertHistoryOperation(group.entries))
                                }

                                ForEach(group.entries) { entry in
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack(alignment: .top, spacing: 8) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(entry.accountId ?? "非账号历史")
                                                    .font(store.textFont(size: store.scaledTextSize(13), weight: .medium))
                                                    .textSelection(.enabled)
                                                Text(entry.action.trimmingCharacters(in: .whitespacesAndNewlines))
                                                    .font(store.textFont(size: store.scaledTextSize(12)))
                                                    .foregroundStyle(.secondary)
                                                    .fixedSize(horizontal: false, vertical: true)
                                            }
                                            Spacer()
                                            Button("撤回该账号") {
                                                store.revertHistoryEntry(entry)
                                            }
                                            .font(store.buttonFont(size: max(12, CGFloat(store.uiButtonFontSize - 4))))
                                            .buttonStyle(.borderedProminent)
                                            .disabled(!store.canRevertHistoryEntry(entry))
                                        }

                                        if let before = entry.accountBefore, let after = entry.accountAfter {
                                            historyDiffRow(title: "变更前", account: before)
                                            historyDiffRow(title: "变更后", account: after)
                                        } else if let before = entry.accountBefore {
                                            historyDiffRow(title: "变更前", account: before)
                                            Text("该账号在这次操作后被移除")
                                                .font(store.textFont(size: store.scaledTextSize(12)))
                                                .foregroundStyle(.secondary)
                                        } else if let after = entry.accountAfter {
                                            Text("该账号在这次操作中新建")
                                                .font(store.textFont(size: store.scaledTextSize(12)))
                                                .foregroundStyle(.secondary)
                                            historyDiffRow(title: "变更后", account: after)
                                        }
                                    }
                                    .padding(10)
                                    .background(Color.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .stroke(Color.black.opacity(0.06), lineWidth: 1)
                                    }
                                }
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.regularMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(18)
        .frame(minWidth: 900, minHeight: 620, alignment: .topLeading)
    }

    @ViewBuilder
    private func historyDiffRow(title: String, account: PasswordAccount) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(store.textFont(size: store.scaledTextSize(12), weight: .semibold))
            Text(accountSummary(account))
                .font(store.textFont(size: store.scaledTextSize(12)))
                .textSelection(.enabled)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func accountSummary(_ account: PasswordAccount) -> String {
        let folders = account.resolvedFolderIds.map { String($0.uuidString.prefix(8)) }.joined(separator: ", ")
        return [
            "用户名: \(account.username)",
            "站点: \(account.sites.joined(separator: ", "))",
            "文件夹: \(folders.isEmpty ? "(无)" : folders)",
            "备注: \(summaryText(account.note))",
            "状态: \(account.isDeleted ? "回收站" : "正常")"
        ].joined(separator: "\n")
    }

    private func summaryText(_ value: String) -> String {
        let normalized = value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return "(空)" }
        if normalized.count <= 120 { return normalized }
        return String(normalized.prefix(120)) + "..."
    }
}

private struct HistoryOperationGroup: Identifiable {
    let id: UUID
    let timestampMs: Int64
    let title: String
    let entries: [OperationHistoryEntry]

    init(entries: [OperationHistoryEntry]) {
        let sortedEntries = entries.sorted { lhs, rhs in
            let lhsAccountId = lhs.accountId ?? ""
            let rhsAccountId = rhs.accountId ?? ""
            if lhsAccountId != rhsAccountId {
                return lhsAccountId < rhsAccountId
            }
            return lhs.id.uuidString < rhs.id.uuidString
        }
        self.id = sortedEntries.first?.operationId ?? UUID()
        self.timestampMs = sortedEntries.map(\.timestampMs).max() ?? 0
        self.title = sortedEntries.first(where: { !($0.operationTitle ?? "").isEmpty })?.operationTitle
            ?? sortedEntries.first?.action
            ?? "历史记录"
        self.entries = sortedEntries
    }
}
