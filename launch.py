import argparse
import subprocess
import tempfile

from pathlib import Path

p = Path(__file__).resolve().parent.joinpath("extension")

def build_feats(insecure=False):
    feats = [
        "DisableLoadExtensionCommandLineSwitch"
    ]

    if insecure:
        feats += [
            "IsolateOrigins",
            "site-per-process",
            "BlockInsecurePrivateNetworkRequests",
            "CrossSiteDocumentBlockingAlways",
            "OutOfBlinkCors",
            "WebSecurity",
            "CORB",
        ]

    return feats

def build_flags(user_data_dir, insecure=False):
    feats = build_feats(insecure)

    flags = [
        f"--user-data-dir={user_data_dir}",
        f"--load-extension={p}",
        "--no-first-run",
        f"--disable-features={','.join(feats)}",
        "--allowlisted-extension-id=foakpmknkkocehoeoafpnejjdhngfldf",
    ]

    if insecure:
        flags += [
            "--disable-web-security",
            "--disable-site-isolation-trials",
            "--allow-running-insecure-content",
            "--allow-insecure-localhost",
            "--disable-client-side-phishing-detection",
        ]

    return flags

parser = argparse.ArgumentParser()

parser.add_argument("--insecure", action="store_true")
parser.add_argument("--bin", default="chrome")
parser.add_argument("--user-data-dir")

args = parser.parse_args()

user_data_dir = args.user_data_dir or tempfile.mkdtemp()

subprocess.Popen(
    [args.bin] + build_flags(user_data_dir, args.insecure),
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)