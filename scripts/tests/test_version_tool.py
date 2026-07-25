import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "version.mjs"


class VersionToolTests(unittest.TestCase):
    def run_tool(self, *args: str) -> str:
        result = subprocess.run(
            ["node", str(TOOL), *args],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def test_decimal_rollover(self) -> None:
        self.assertEqual(self.run_tool("next", "1.0.0"), "1.0.1")
        self.assertEqual(self.run_tool("next", "1.0.9"), "1.1.0")
        self.assertEqual(self.run_tool("next", "1.9.9"), "2.0.0")

    def test_repository_versions_are_aligned(self) -> None:
        output = self.run_tool("check")
        self.assertIn("VERSION_CHECK_OK", output)
        self.assertIn("33 entries", output)


if __name__ == "__main__":
    unittest.main()
