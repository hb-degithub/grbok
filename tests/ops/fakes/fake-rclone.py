import os
import pathlib
import shutil
import sys


def remote_path(spec):
    if ":" not in spec:
        raise ValueError("remote spec required")
    _, relative = spec.split(":", 1)
    if ".." in pathlib.PurePosixPath(relative).parts:
        raise ValueError("unsafe remote path")
    return pathlib.Path(os.environ["FAKE_RCLONE_ROOT"]) / pathlib.PurePosixPath(relative)


def main():
    args = sys.argv[1:]
    if not args:
        return 2
    mode = os.environ.get("FAKE_RCLONE_MODE", "")
    command = args[0]
    if command == "copyto" and len(args) == 3:
        source = pathlib.Path(args[1])
        target = remote_path(args[2])
        if mode == "fail-copy" or (mode == "fail-manifest" and target.name.endswith(".manifest.json")):
            return 8
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        return 0
    if command == "cat" and len(args) == 2:
        if mode == "fail-cat":
            return 9
        source = remote_path(args[1])
        if not source.is_file():
            return 3
        sys.stdout.buffer.write(source.read_bytes())
        return 0
    if command == "deletefile" and len(args) == 2:
        target = remote_path(args[1])
        if target.exists():
            target.unlink()
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

