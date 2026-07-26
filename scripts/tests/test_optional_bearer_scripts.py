import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = [
    ROOT / "apps" / "sync_server_ubuntu" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "install-launchd.sh",
    ROOT / "apps" / "sync_server_ubuntu" / "deploy.sh",
    ROOT / "apps" / "sync_server_ubuntu" / "rotate_token.sh",
]


class OptionalBearerScriptTests(unittest.TestCase):
    def test_scripts_never_generate_tokens(self) -> None:
        for script in SCRIPTS:
            source = script.read_text(encoding="utf-8")
            self.assertNotIn("openssl rand", source, script)
            self.assertNotIn("GENERATED_TOKEN", source, script)

    def test_local_scripts_do_not_print_configured_token(self) -> None:
        for relative in ["start.sh", "install-launchd.sh"]:
            script = ROOT / "apps" / "sync_server_local" / relative
            source = script.read_text(encoding="utf-8")
            self.assertIn("（已配置，不显示）", source, script)
            self.assertNotIn('访问令牌:   ${PASS_SYNC_BEARER_TOKENS', source, script)
            self.assertNotIn('访问令牌:   ${TOKEN_CONFIG', source, script)

    def test_rotation_requires_user_provided_token_and_does_not_echo_it(self) -> None:
        source = (ROOT / "apps" / "sync_server_ubuntu" / "rotate_token.sh").read_text(encoding="utf-8")
        self.assertIn("PASS_SYNC_NEW_BEARER_TOKEN", source)
        self.assertIn("项目不会自动生成 Token", source)
        self.assertIn("umask 077", source)
        self.assertIn("Token 不能包含逗号或空白字符", source)
        self.assertNotIn("仅显示一次", source)
        self.assertNotIn('printf \'%s\\n\' "$TOKEN"', source)

    def test_rotation_writes_user_token_privately_without_echoing_it(self) -> None:
        script = ROOT / "apps" / "sync_server_ubuntu" / "rotate_token.sh"
        token = "user-supplied_+/=token"
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tokens.conf"
            env = os.environ.copy()
            env["PASS_SYNC_NEW_BEARER_TOKEN"] = token
            result = subprocess.run(
                ["bash", str(script), str(destination), "default"],
                cwd=ROOT,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(destination.read_text(encoding="utf-8"), f"default={token}\n")
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(token, result.stdout)
            self.assertNotIn(token, result.stderr)

    def test_rotation_rejects_unparseable_token_without_creating_file(self) -> None:
        script = ROOT / "apps" / "sync_server_ubuntu" / "rotate_token.sh"
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tokens.conf"
            env = os.environ.copy()
            env["PASS_SYNC_NEW_BEARER_TOKEN"] = "invalid,token"
            result = subprocess.run(
                ["bash", str(script), str(destination), "default"],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(destination.exists())

    def test_local_server_scripts_print_current_v2_endpoint(self) -> None:
        scripts = [
            ROOT / "apps" / "sync_server_local" / "start.sh",
            ROOT / "apps" / "sync_server_local" / "install-launchd.sh",
            ROOT / "apps" / "sync_server_ubuntu" / "start.sh",
        ]
        for script in scripts:
            source = script.read_text(encoding="utf-8")
            self.assertIn("/v2/sync/state", source, script)
            self.assertNotIn("/v1/sync/payload", source, script)
        for relative in ["start.sh", "install-launchd.sh"]:
            source = (ROOT / "apps" / "sync_server_local" / relative).read_text(encoding="utf-8")
            self.assertIn("跨设备请配置 HTTPS", source)

    def test_launchd_persists_plaintext_policy(self) -> None:
        source = (ROOT / "apps" / "sync_server_local" / "install-launchd.sh").read_text(encoding="utf-8")
        self.assertIn('ALLOW_PLAINTEXT_INPUT=$(printf', source)
        self.assertIn('case "${ALLOW_PLAINTEXT_INPUT}" in', source)
        self.assertIn('1|true|yes) ALLOW_PLAINTEXT_CONFIG="1"', source)
        self.assertIn('0|false|no) ALLOW_PLAINTEXT_CONFIG="0"', source)
        self.assertIn("<key>PASS_SYNC_ALLOW_PLAINTEXT</key>", source)

    def test_scripts_have_valid_shell_syntax(self) -> None:
        for script in SCRIPTS:
            subprocess.run(["bash", "-n", str(script)], check=True, cwd=ROOT)

    def test_deployment_separates_source_and_install_paths(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "deploy-sync-server.yml").read_text(encoding="utf-8")
        deploy = (ROOT / "apps" / "sync_server_ubuntu" / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn("source_dir=/opt/pass-sync-source", workflow)
        self.assertIn("PASS_SYNC_INSTALL_DIR:-/opt/pass-sync-server", deploy)
        self.assertIn("restore_previous_installation", deploy)
        self.assertIn("pass-sync-server-backup.timer", deploy)
        self.assertIn('/proc/${main_pid}/environ', deploy)
        self.assertIn('exit "${failure_status}"', deploy)
        self.assertIn("persist_runtime_setting PASS_SYNC_PORT", deploy)
        self.assertIn("migrated_legacy_env=1", deploy)

    def test_backup_service_uses_installed_script(self) -> None:
        service = (ROOT / "apps" / "sync_server_ubuntu" / "pass-sync-server-backup.service").read_text(
            encoding="utf-8"
        )
        self.assertIn("ExecStart=/opt/pass-sync-server/backup_sync_db.sh", service)
        self.assertNotIn("/apps/sync_server_ubuntu/", service)

    def test_service_loads_optional_tls_settings_from_environment_file(self) -> None:
        service = (ROOT / "apps" / "sync_server_ubuntu" / "pass-sync-server.service").read_text(encoding="utf-8")
        self.assertIn("EnvironmentFile=-/etc/pass-sync/pass-sync-server.env", service)
        self.assertIn("TLS is optional", service)
        self.assertNotIn("Environment=PASS_SYNC_TLS_CERT=", service)
        self.assertNotIn("Environment=PASS_SYNC_TLS_KEY=", service)
        self.assertNotIn("EnvironmentFile=-/etc/pass-sync-server.env", service)


if __name__ == "__main__":
    unittest.main()
