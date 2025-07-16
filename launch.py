import subprocess
import tempfile

from pathlib import Path

p = Path(__file__).resolve().parent.joinpath("extension")
t = tempfile.mkdtemp()

subprocess.Popen(
    [
        "chrome",
        f"--user-data-dir={t}",
        f"--load-extension={p}",
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--no-first-run",
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)