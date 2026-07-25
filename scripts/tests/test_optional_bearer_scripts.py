import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = [
    ROOT / "apps" / "sync_server_ubuntu" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "start.sh",
    ROOT / "apps" / "sync_server_local" / "install-launchd.sh",
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


if __name__ == "__main__":
    unittest.main()
