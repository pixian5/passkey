import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = [
    ROOT / "apps" / "sync_server_ubuntu" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "install-launchd.sh",
    ROOT / "apps" / "sync_server_ubuntu" / "deploy.sh",
]


class OptionalBearerScriptTests(unittest.TestCase):
    def test_scripts_never_generate_tokens(self) -> None:
        for script in SCRIPTS:
            source = script.read_text(encoding="utf-8")
            self.assertNotIn("openssl rand", source, script)
            self.assertNotIn("GENERATED_TOKEN", source, script)

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
