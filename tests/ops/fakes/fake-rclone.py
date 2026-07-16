import os
import pathlib
import shutil
import sys
import json
import re


def remote_path(spec):
    if ":" not in spec:
        raise ValueError("remote spec required")
    _, relative = spec.split(":", 1)
    if ".." in pathlib.PurePosixPath(relative).parts:
        raise ValueError("unsafe remote path")
    return pathlib.Path(os.environ["FAKE_RCLONE_ROOT"]) / pathlib.PurePosixPath(relative)


def version_marker_path(path):
    stem, suffix = path.name.rsplit(".", 1)
    return path.with_name(f"{stem}-v2099-01-01-000000-000.{suffix}")


def is_version_name(name):
    return re.search(r"-v\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.[^.]+$", name) is not None


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
    if command == "deletefile" and len(args) == 4 and args[2:] == ["--s3-versions", "--s3-version-deleted"]:
        if mode == "fail-retention-purge":
            return 10
        target = remote_path(args[1])
        if target.exists():
            target.unlink()
            if not is_version_name(target.name):
                marker = version_marker_path(target)
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_bytes(b"")
        return 0
    if command == "deletefile" and len(args) == 2:
        target = remote_path(args[1])
        if target.exists():
            target.unlink()
        return 0
    if command == "lsjson" and len(args) == 5 and args[2:] == ["--s3-versions", "--s3-version-deleted", "--recursive"]:
        directory = remote_path(args[1])
        rows = []
        if directory.is_dir():
            for item in sorted(directory.rglob("*")):
                if item.is_file():
                    rows.append({"Path": item.relative_to(directory).as_posix(), "Name": item.name, "Size": item.stat().st_size, "IsDir": False})
        sys.stdout.write(json.dumps(rows, separators=(",", ":")))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
