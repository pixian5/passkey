import Foundation

enum ServerSSHAuthMode: String, CaseIterable, Codable, Identifiable {
    case password
    case privateKey

    var id: String { rawValue }

    var label: String {
        switch self {
        case .password: return "密码"
        case .privateKey: return "私钥"
        }
    }
}

struct ServerSSHCredential: Codable, Equatable {
    var username: String = "root"
    var port: Int = 22
    var authMode: ServerSSHAuthMode = .privateKey
    var secret: String = ""
    var privateKeyPassphrase: String = ""
}

struct ServerProvisioningResult: Equatable {
    let host: String
    let port: Int
    let endpoint: String
}

enum ServerProvisioningError: LocalizedError {
    case invalidEndpoint
    case invalidSSHPort
    case missingToken
    case invalidToken
    case missingCredential
    case resourceUnavailable(String)
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            return "服务器地址必须是 HTTPS URL，并包含有效主机名"
        case .invalidSSHPort:
            return "SSH 端口必须是 1 到 65535 之间的数字"
        case .missingToken:
            return "请先填写访问令牌，再接入服务器"
        case .invalidToken:
            return "访问令牌不能包含逗号、换行或回车"
        case .missingCredential:
            return "请填写 SSH 密码或私钥"
        case .resourceUnavailable(let name):
            return "App 未包含同步服务文件：\(name)"
        case .commandFailed(let message):
            return message
        }
    }
}

enum ServerSSHCredentialStore {
    private static let fileName = "server-connection-credentials-v1.json"
    private static let currentVersion = 1
    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    private static let decoder = JSONDecoder()

    private struct File: Codable {
        let version: Int
        var values: [String: ServerSSHCredential]
    }

    static func load(host: String) -> ServerSSHCredential? {
        guard let data = PassSharedFileSecretStore.read(named: fileName),
              let plaintext = try? PassSharedCrypto.decryptLocalSecret(data),
              let file = try? decoder.decode(File.self, from: plaintext),
              file.version == currentVersion
        else {
            return nil
        }
        return file.values[key(for: host)]
    }

    @discardableResult
    static func save(_ credential: ServerSSHCredential, host: String) -> Bool {
        var values = loadFile()?.values ?? [:]
        values[key(for: host)] = credential
        let file = File(version: currentVersion, values: values)
        guard let plaintext = try? encoder.encode(file),
              let encrypted = try? PassSharedCrypto.encryptLocalSecret(plaintext)
        else {
            return false
        }
        return PassSharedFileSecretStore.write(encrypted, named: fileName)
    }

    private static func loadFile() -> File? {
        guard let data = PassSharedFileSecretStore.read(named: fileName),
              let plaintext = try? PassSharedCrypto.decryptLocalSecret(data),
              let file = try? decoder.decode(File.self, from: plaintext),
              file.version == currentVersion
        else {
            return nil
        }
        return file
    }

    private static func key(for host: String) -> String {
        host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

enum ServerProvisioningService {
    private struct Endpoint {
        let host: String
        let endpoint: String
        let backendPort: Int
        let usesTLS: Bool
    }

    private struct TemporaryFiles {
        let directory: URL
        let key: URL?
        let askpass: URL?
        let password: URL?
        let knownHosts: URL

        func remove() {
            try? FileManager.default.removeItem(at: directory)
        }
    }

    static func deploy(
        serverURL rawServerURL: String,
        credential: ServerSSHCredential,
        accessToken rawAccessToken: String,
        syncEncryptionKey rawSyncEncryptionKey: String
    ) async throws -> ServerProvisioningResult {
        let endpoint = try parseEndpoint(rawServerURL)
        let accessToken = rawAccessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !accessToken.isEmpty else { throw ServerProvisioningError.missingToken }
        guard !accessToken.contains(","),
              !accessToken.contains("\n"),
              !accessToken.contains("\r")
        else { throw ServerProvisioningError.invalidToken }
        let syncEncryptionKey = rawSyncEncryptionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard PassSyncCrypto.isValidKeyString(syncEncryptionKey) else {
            throw ServerProvisioningError.commandFailed("同步加密密钥无效，必须是 256 位密钥；留空表示明文同步")
        }
        guard !credential.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !credential.secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw ServerProvisioningError.missingCredential }
        guard (1 ... 65535).contains(credential.port) else {
            throw ServerProvisioningError.invalidSSHPort
        }

        let resources = try bundledResources()
        let temporary = try makeTemporaryFiles(endpoint: endpoint, credential: credential)
        defer { temporary.remove() }

        let runner = SSHRunner(
            endpoint: endpoint,
            credential: credential,
            temporary: temporary
        )
        if endpoint.usesTLS {
            guard try runner.fileExists("/etc/bz/certs/server.crt"),
                  try runner.fileExists("/etc/bz/certs/server.key")
            else {
                throw ServerProvisioningError.commandFailed(
                    "服务器 URL 使用了 HTTPS 端口，但服务器缺少 /etc/bz/certs/server.crt 或 server.key"
                )
            }
        }
        let stage = "/tmp/pass-sync-provision-\(UUID().uuidString.lowercased())"
        try runner.run("mkdir -p '\(stage)'")
        defer { try? runner.run("rm -rf '\(stage)'") }

        try runner.copy(resources.server, to: "\(stage)/pass_sync_server.py")
        try runner.copy(resources.backup, to: "\(stage)/backup_sync_db.sh")
        try runner.write(
            Data("default=\(accessToken)\n".utf8),
            to: "\(stage)/tokens.conf",
            mode: "0600"
        )
        try runner.write(
            Data(serviceText(endpoint: endpoint).utf8),
            to: "\(stage)/pass-sync-server.service",
            mode: "0644"
        )
        try runner.write(
            Data(backupServiceText.utf8),
            to: "\(stage)/pass-sync-server-backup.service",
            mode: "0644"
        )
        try runner.write(
            Data(backupTimerText.utf8),
            to: "\(stage)/pass-sync-server-backup.timer",
            mode: "0644"
        )
        try runner.write(
            Data(environmentText(syncEncryptionKey: syncEncryptionKey).utf8),
            to: "\(stage)/pass-sync-server.env",
            mode: "0600"
        )

        let installCommand = installCommand(stage: stage, endpoint: endpoint)
        try runner.run(installCommand)
        return ServerProvisioningResult(
            host: endpoint.host,
            port: endpoint.backendPort,
            endpoint: endpoint.endpoint
        )
    }

    static func host(from rawServerURL: String) -> String? {
        try? parseEndpoint(rawServerURL).host
    }

    static func verifyPublicEndpoint(_ endpoint: String) async -> Bool {
        guard let url = URL(string: endpoint.trimmingCharacters(in: .whitespacesAndNewlines) + "/healthz") else {
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private static func parseEndpoint(_ rawValue: String) throws -> Endpoint {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed.lowercased()),
              let scheme = components.scheme,
              scheme == "https",
              let host = components.host,
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else { throw ServerProvisioningError.invalidEndpoint }

        let explicitPort = components.port
        let backendPort = explicitPort ?? 53333
        guard (1 ... 65535).contains(backendPort) else {
            throw ServerProvisioningError.invalidEndpoint
        }
        let renderedHost = host.contains(":") ? "[\(host)]" : host
        let endpoint = "https://\(renderedHost)\(explicitPort.map { ":\($0)" } ?? "")"
        return Endpoint(
            host: host,
            endpoint: endpoint,
            backendPort: backendPort,
            usesTLS: explicitPort != nil
        )
    }

    private static func bundledResources() throws -> (server: URL, backup: URL) {
        guard let server = Bundle.main.url(
            forResource: "pass_sync_server",
            withExtension: "py"
        ) else {
            throw ServerProvisioningError.resourceUnavailable("pass_sync_server.py")
        }
        guard let backup = Bundle.main.url(
            forResource: "backup_sync_db",
            withExtension: "sh"
        ) else {
            throw ServerProvisioningError.resourceUnavailable("backup_sync_db.sh")
        }
        return (server, backup)
    }

    private static func makeTemporaryFiles(
        endpoint: Endpoint,
        credential: ServerSSHCredential
    ) throws -> TemporaryFiles {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("passmac-ssh-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

        let knownHosts = PassSharedData.dataDirectoryURL()
            .appendingPathComponent("ssh-known-hosts", isDirectory: false)
        try FileManager.default.createDirectory(
            at: knownHosts.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: knownHosts.path) {
            FileManager.default.createFile(atPath: knownHosts.path, contents: Data(), attributes: [.posixPermissions: 0o600])
        } else {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: knownHosts.path)
        }

        var keyURL: URL?
        if credential.authMode == .privateKey {
            let url = directory.appendingPathComponent("id_key", isDirectory: false)
            let keyData = Data(credential.secret.replacingOccurrences(of: "\r\n", with: "\n").utf8)
            try keyData.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            keyURL = url
        }

        var askpassURL: URL?
        var passwordURL: URL?
        if credential.authMode == .password || !credential.privateKeyPassphrase.isEmpty {
            let password = credential.authMode == .password ? credential.secret : credential.privateKeyPassphrase
            let valueURL = directory.appendingPathComponent("askpass-value", isDirectory: false)
            try Data(password.utf8).write(to: valueURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: valueURL.path)
            let scriptURL = directory.appendingPathComponent("askpass.sh", isDirectory: false)
            let script = "#!/bin/sh\n/bin/cat \"$PASSMAC_SSH_PASSWORD_FILE\"\n"
            try Data(script.utf8).write(to: scriptURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)
            askpassURL = scriptURL
            passwordURL = valueURL
        }

        return TemporaryFiles(
            directory: directory,
            key: keyURL,
            askpass: askpassURL,
            password: passwordURL,
            knownHosts: knownHosts
        )
    }

    private static func serviceText(endpoint: Endpoint) -> String {
        var lines = [
            "[Unit]",
            "Description=Pass Sync Server",
            "After=network.target",
            "",
            "[Service]",
            "Type=simple",
            "User=pass",
            "Group=pass",
            "WorkingDirectory=/opt/pass-sync-server",
            "Environment=PASS_SYNC_HOST=\(endpoint.usesTLS ? "0.0.0.0" : "127.0.0.1")",
            "Environment=PASS_SYNC_PORT=\(endpoint.backendPort)",
            "Environment=PASS_SYNC_DB_PATH=/var/lib/pass-sync/pass_sync.sqlite3",
            "Environment=PASS_SYNC_BEARER_TOKENS_FILE=/etc/pass-sync/tokens.conf",
            "EnvironmentFile=-/etc/pass-sync/pass-sync-server.env",
            "Environment=PASS_SYNC_LOG_LEVEL=INFO",
            "Environment=PASS_SYNC_RATE_LIMIT_PER_MINUTE=120",
            "Environment=PASS_SYNC_CLIENT_TIMEOUT_SECONDS=15",
            "Environment=PASS_SYNC_MAX_CONCURRENT_REQUESTS=32",
        ]
        if endpoint.usesTLS {
            lines.append("Environment=PASS_SYNC_TLS_CERT=/etc/pass-sync/tls/server.crt")
            lines.append("Environment=PASS_SYNC_TLS_KEY=/etc/pass-sync/tls/server.key")
        }
        lines += [
            "ExecStart=/usr/bin/python3 /opt/pass-sync-server/pass_sync_server.py",
            "Restart=always",
            "RestartSec=2",
            "",
            "[Install]",
            "WantedBy=multi-user.target",
            "",
        ]
        return lines.joined(separator: "\n")
    }

    private static let backupServiceText = """
    [Unit]
    Description=Backup Pass Sync Server database
    After=pass-sync-server.service

    [Service]
    Type=oneshot
    User=root
    ExecStart=/opt/pass-sync-server/backup_sync_db.sh
    """

    private static let backupTimerText = """
    [Unit]
    Description=Daily Pass Sync Server database backup

    [Timer]
    OnCalendar=*-*-* 03:20:00
    Persistent=true
    RandomizedDelaySec=15m

    [Install]
    WantedBy=timers.target
    """

    private static func environmentText(syncEncryptionKey: String) -> String {
        let configured = !syncEncryptionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return "# 由 PassMac 接入服务器生成\nPASS_SYNC_ALLOW_PLAINTEXT=\(configured ? "0" : "1")\n"
    }

    private static func installCommand(stage: String, endpoint: Endpoint) -> String {
        """
        set -eu
        if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
        $SUDO sh -c 'getent group pass >/dev/null 2>&1 || groupadd --system pass'
        $SUDO sh -c 'id -u pass >/dev/null 2>&1 || useradd --system --gid pass --home-dir /nonexistent --shell /usr/sbin/nologin pass'
        $SUDO install -d -m 0755 /opt/pass-sync-server /etc/pass-sync /var/lib/pass-sync /var/lib/pass-sync/backups
        if [ -f /var/lib/pass-sync/pass_sync.sqlite3 ]; then
          stamp=$(date +%Y%m%d-%H%M%S)
          $SUDO install -d -m 0750 "/var/lib/pass-sync/backups/$stamp-pre-provision"
          if command -v sqlite3 >/dev/null 2>&1; then
            $SUDO sqlite3 /var/lib/pass-sync/pass_sync.sqlite3 ".backup '/var/lib/pass-sync/backups/$stamp-pre-provision/pass_sync.sqlite3'"
          else
            $SUDO cp -a /var/lib/pass-sync/pass_sync.sqlite3 "/var/lib/pass-sync/backups/$stamp-pre-provision/pass_sync.sqlite3"
          fi
        fi
        $SUDO install -m 0644 '\(stage)/pass_sync_server.py' /opt/pass-sync-server/pass_sync_server.py
        $SUDO install -m 0755 '\(stage)/backup_sync_db.sh' /opt/pass-sync-server/backup_sync_db.sh
        $SUDO install -m 0600 '\(stage)/tokens.conf' /etc/pass-sync/tokens.conf
        $SUDO chown pass:pass /etc/pass-sync/tokens.conf
        $SUDO install -m 0600 '\(stage)/pass-sync-server.env' /etc/pass-sync/pass-sync-server.env
        $SUDO chown root:root /etc/pass-sync/pass-sync-server.env
        if [ "\(endpoint.usesTLS ? "1" : "0")" = "1" ]; then
          $SUDO install -d -m 0750 -o pass -g pass /etc/pass-sync/tls
          $SUDO install -m 0644 -o pass -g pass /etc/bz/certs/server.crt /etc/pass-sync/tls/server.crt
          $SUDO install -m 0600 -o pass -g pass /etc/bz/certs/server.key /etc/pass-sync/tls/server.key
        fi
        $SUDO install -m 0644 '\(stage)/pass-sync-server.service' /etc/systemd/system/pass-sync-server.service
        $SUDO install -m 0644 '\(stage)/pass-sync-server-backup.service' /etc/systemd/system/pass-sync-server-backup.service
        $SUDO install -m 0644 '\(stage)/pass-sync-server-backup.timer' /etc/systemd/system/pass-sync-server-backup.timer
        $SUDO chown -R pass:pass /var/lib/pass-sync
        $SUDO systemctl daemon-reload
        $SUDO systemctl enable pass-sync-server pass-sync-server-backup.timer >/dev/null
        $SUDO systemctl restart pass-sync-server
        $SUDO systemctl enable --now pass-sync-server-backup.timer >/dev/null
        if [ "\(endpoint.usesTLS ? "1" : "0")" = "1" ]; then
          if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
            $SUDO ufw allow \(endpoint.backendPort)/tcp >/dev/null
          fi
          healthy=0
          for attempt in $(seq 1 30); do
            if curl --fail --silent --show-error --insecure --max-time 15 https://127.0.0.1:\(endpoint.backendPort)/healthz >/dev/null; then
              healthy=1
              break
            fi
            sleep 1
          done
        else
          healthy=0
          for attempt in $(seq 1 30); do
            if curl --fail --silent --show-error --max-time 15 http://127.0.0.1:\(endpoint.backendPort)/healthz >/dev/null; then
              healthy=1
              break
            fi
            sleep 1
          done
        fi
        if [ "$healthy" -ne 1 ]; then
          echo "同步服务启动后健康检查失败" >&2
          exit 1
        fi
        rm -rf '\(stage)'
        """
    }

    private struct SSHRunner {
        let endpoint: Endpoint
        let credential: ServerSSHCredential
        let temporary: TemporaryFiles

        func run(_ command: String) throws {
            _ = try execute(
                executable: "/usr/bin/ssh",
                arguments: sshArguments(command: command),
                input: nil
            )
        }

        func fileExists(_ path: String) throws -> Bool {
            _ = try execute(
                executable: "/usr/bin/ssh",
                arguments: sshArguments(command: "test -r \(shellQuote(path))"),
                input: nil
            )
            return true
        }

        func write(_ data: Data, to path: String, mode: String) throws {
            _ = try execute(
                executable: "/usr/bin/ssh",
                arguments: sshArguments(
                    command: "umask 077; cat > \(shellQuote(path)); chmod \(shellQuote(mode)) \(shellQuote(path))"
                ),
                input: data
            )
        }

        func copy(_ localURL: URL, to remotePath: String) throws {
            _ = try execute(
                executable: "/usr/bin/scp",
                arguments: scpArguments(localURL: localURL, remotePath: remotePath),
                input: nil
            )
        }

        private func sshArguments(command: String) -> [String] {
            var arguments = baseArguments()
            arguments += ["\(credential.username)@\(sshHost)", command]
            return arguments
        }

        private func scpArguments(localURL: URL, remotePath: String) -> [String] {
            var arguments = baseArguments(includeUserKnownHosts: true)
            if let index = arguments.firstIndex(of: "-p") {
                arguments[index] = "-P"
            }
            arguments += [localURL.path, "\(credential.username)@\(sshHost):\(shellQuote(remotePath))"]
            return arguments
        }

        private func shellQuote(_ value: String) -> String {
            "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
        }

        private var sshHost: String {
            endpoint.host.contains(":") ? "[\(endpoint.host)]" : endpoint.host
        }

        private func baseArguments(includeUserKnownHosts: Bool = true) -> [String] {
            var arguments = [
                "-p", String(credential.port),
                "-o", "BatchMode=no",
                "-o", "NumberOfPasswordPrompts=1",
                "-o", "ConnectTimeout=15",
                "-o", "ServerAliveInterval=15",
                "-o", "ServerAliveCountMax=2",
                "-o", "StrictHostKeyChecking=accept-new",
                "-o", "LogLevel=ERROR",
            ]
            if includeUserKnownHosts {
                arguments += ["-o", "UserKnownHostsFile=\(temporary.knownHosts.path)"]
            }
            if let key = temporary.key {
                arguments += ["-i", key.path, "-o", "IdentitiesOnly=yes", "-o", "PasswordAuthentication=no"]
            } else {
                arguments += ["-o", "PubkeyAuthentication=no"]
            }
            return arguments
        }

        private func execute(executable: String, arguments: [String], input: Data?) throws -> Data {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.environment = environment()
            let output = Pipe()
            let error = Pipe()
            process.standardOutput = output
            process.standardError = error
            if let input {
                let inputPipe = Pipe()
                process.standardInput = inputPipe
                try process.run()
                inputPipe.fileHandleForWriting.write(input)
                inputPipe.fileHandleForWriting.closeFile()
            } else {
                process.standardInput = FileHandle.nullDevice
                try process.run()
            }
            process.waitUntilExit()
            let stdout = output.fileHandleForReading.readDataToEndOfFile()
            let stderr = error.fileHandleForReading.readDataToEndOfFile()
            guard process.terminationStatus == 0 else {
                let detail = String(data: stderr.isEmpty ? stdout : stderr, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                throw ServerProvisioningError.commandFailed(
                    detail.map { "SSH 操作失败：\($0.prefix(400))" } ?? "SSH 操作失败"
                )
            }
            return stdout
        }

        private func environment() -> [String: String] {
            var values = ProcessInfo.processInfo.environment
            if let askpass = temporary.askpass, let password = temporary.password {
                values["SSH_ASKPASS"] = askpass.path
                values["SSH_ASKPASS_REQUIRE"] = "force"
                values["DISPLAY"] = ":0"
                values["PASSMAC_SSH_PASSWORD_FILE"] = password.path
            }
            return values
        }
    }
}
