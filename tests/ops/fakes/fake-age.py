import os
import pathlib
import shutil
import sys
import time


def main():
    if os.environ.get("FAKE_AGE_MODE") == "timeout":
        time.sleep(2)
    if os.environ.get("FAKE_AGE_MODE") == "fail":
        return 7
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "-y":
        identity = pathlib.Path(args[1])
        if not identity.is_file():
            return 4
        recipient = identity.read_text(encoding="utf-8").splitlines()[0].strip()
        if not recipient:
            return 5
        sys.stdout.write(recipient + "\n")
        return 0
    if len(args) == 6 and args[0] == "--decrypt" and args[1] == "--identity" and args[3] == "--output":
        identity = pathlib.Path(args[2])
        output = pathlib.Path(args[4])
        source = pathlib.Path(args[5])
        if not identity.is_file():
            return 4
        payload = source.read_bytes()
        header = b"FAKE-AGE-V1\n"
        if not payload.startswith(header):
            return 5
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(payload[len(header):])
        return 0
    recipients = []
    index = 0
    while index + 1 < len(args) and args[index] == "--recipient":
        recipients.append(args[index + 1])
        index += 2
    if not 1 <= len(recipients) <= 2 or index + 2 >= len(args) or args[index] != "--output":
        return 2
    output = pathlib.Path(args[index + 1])
    source = pathlib.Path(args[index + 2])
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as target:
        target.write(b"FAKE-AGE-V1\n")
        with source.open("rb") as source_file:
            shutil.copyfileobj(source_file, target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
