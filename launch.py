import argparse
import subprocess
import tempfile

from pathlib import Path

p = Path(__file__).resolve().parent.joinpath("extension")
t = tempfile.mkdtemp()

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

def build_flags(insecure=False):
    feats = build_feats(insecure)

    flags = [
        f"--user-data-dir={t}",
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

parser.add_argument(
    "--insecure",
    action="store_true"
)

subprocess.Popen(
    ["chrome"] + build_flags(
        parser.parse_args().insecure,
    ),
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)