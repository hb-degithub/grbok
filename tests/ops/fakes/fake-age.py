import os
import pathlib
import shutil
import sys


def main():
    if os.environ.get("FAKE_AGE_MODE") == "fail":
        return 7
    args = sys.argv[1:]
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
    if len(args) != 5 or args[0] != "--recipient" or args[2] != "--output":
        return 2
    output = pathlib.Path(args[3])
    source = pathlib.Path(args[4])
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as target:
        target.write(b"FAKE-AGE-V1\n")
        with source.open("rb") as source_file:
            shutil.copyfileobj(source_file, target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
