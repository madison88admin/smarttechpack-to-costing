"""Small SSH/SFTP helper for controlled Smart TP Costing deployments.

Credentials are read from environment variables and are never printed or saved.
"""

from __future__ import annotations

import argparse
import os
import sys

import paramiko


def connect() -> paramiko.SSHClient:
    host = os.environ.get("TP_VPS_HOST")
    user = os.environ.get("TP_VPS_USER")
    password = os.environ.get("TP_VPS_PASSWORD")
    if not host or not user or not password:
        raise RuntimeError("TP_VPS_HOST, TP_VPS_USER, and TP_VPS_PASSWORD are required")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, username=user, password=password, timeout=15, banner_timeout=15)
    return client


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    execute = sub.add_parser("exec")
    execute.add_argument("command")
    upload = sub.add_parser("upload")
    upload.add_argument("local")
    upload.add_argument("remote")
    args = parser.parse_args()

    client = connect()
    try:
        if args.action == "upload":
            with client.open_sftp() as sftp:
                sftp.put(args.local, args.remote)
            print(f"uploaded: {args.remote}")
            return 0

        _, stdout, stderr = client.exec_command(args.command, timeout=180)
        stdout_text = stdout.read().decode("utf-8", errors="replace")
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        if stdout_text:
            sys.stdout.buffer.write(stdout_text.encode(sys.stdout.encoding or "utf-8", errors="replace"))
        if stderr_text:
            sys.stderr.buffer.write(stderr_text.encode(sys.stderr.encoding or "utf-8", errors="replace"))
        return stdout.channel.recv_exit_status()
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
