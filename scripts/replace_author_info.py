#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Firefly 作者信息批量替换脚本（Windows 可直接运行）。

设计原则：
1. 只处理作者署名、仓库链接、联系方式等元信息文本；
2. 保留源代码文件头部的原作者版权/作者声明，并追加 Modified by 行；
3. LICENSE 只修改版权所有者行，保留完整 MIT 协议正文；
4. 不确定的文本一律标记【人工复核】，不自动替换；
5. 默认 dry-run：只打印预览并生成对照报告，不写入磁盘；
6. 传入 --apply 后才执行真实替换，同时把改动写入日志。

用法：
    python scripts/replace_author_info.py           # 预览
    python scripts/replace_author_info.py --apply   # 执行
"""

from __future__ import annotations

import argparse
import datetime
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

USER_NAME = "E-Mufeng"
USER_EMAIL = "chenormonsters@gmail.com"
USER_GITHUB = "https://github.com/E-Mufeng"
USER_REPO = "https://github.com/E-Mufeng/mufeng--Firefly"
USER_REPO_SHORT = "E-Mufeng/mufeng--Firefly"
MODIFIED_MARK = f"Modified by {USER_NAME} <{USER_EMAIL}>"

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".output",
    ".cache",
    ".svelte-kit",
    ".astro",
    ".vercel",
    ".playwright-cli",
    "__pycache__",
}

SKIP_FILES = {
    "replace_author_info.py",
    "author_replacement_report.md",
    "author_replace_log.txt",
}

BINARY_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".ico",
    ".mp3",
    ".mp4",
    ".webm",
    ".mov",
    ".avi",
    ".zip",
    ".7z",
    ".rar",
    ".gz",
    ".tar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".wasm",
    ".pdf",
    ".pyc",
    ".bin",
}

# 有明确替换值的直接替换，按顺序执行。
DIRECT_REPLACEMENTS = [
    ("https://github.com/Cuteleaf/Firefly.git", f"https://github.com/{USER_REPO_SHORT}.git"),
    ("https://github.com/Cuteleaf/Firefly", USER_REPO),
    ("https://github.com/CuteLeaf/Firefly", USER_REPO),
    ("CuteLeaf/Firefly", USER_REPO_SHORT),
    ("- CuteLeaf", "- E-Mufeng"),
    ("users/xiaye", "users/E-Mufeng"),
    ('username: "cuteleaf"', 'username: "E-Mufeng"'),
    ("xiaye@msn.com", USER_EMAIL),
]

# 没有明确替换值，脚本只扫描并报告，不自动修改。
MANUAL_PATTERNS = [
    "https://firefly.cuteleaf.cn",
    "https://docs-firefly.cuteleaf.cn",
    "https://blog.cuteleaf.cn",
    "https://ko-fi.com/cuteleaf",
    "https://ifdian.net/a/cuteleaf",
    "https://bed.twoleaf.cn",
    "ko_fi: cuteleaf",
    "author: emn178",
    "夏叶",
    "夏夜流萤",
]

# 源代码文件头部：保留原作者行，追加 Modified by 行。
SOURCE_HEADER_APPENDS = {
    "src/plugins/remark-wiki-link.js": {
        "anchor": " * @author CuteLeaf <xiaye@msn.com>",
        "append": " * Modified by E-Mufeng <chenormonsters@gmail.com>",
    },
    "src/utils/memos-adapter.ts": {
        "anchor": " * @author: CuteLeaf <xiaye@msn.com>",
        "append": " * Modified by E-Mufeng <chenormonsters@gmail.com>",
    },
    "public/assets/css/twikoo-custom.css": {
        "anchor": " * Firefly 主题专用：https://github.com/CuteLeaf/Firefly",
        "append": " * Modified by E-Mufeng <chenormonsters@gmail.com>",
    },
}

# README 版权行：保留原行，追加一行修改署名。
README_COPYRIGHT_APPENDS = {
    "README.md",
    "README.en.md",
    "docs/README.zh-TW.md",
    "docs/README.ja.md",
}
README_COPYRIGHT_PATTERN = re.compile(
    r"- Copyright \(c\) 2025 \[CuteLeaf\]\(https://github\.com/CuteLeaf\) "
    r"- \[Firefly\]\(https://github\.com/CuteLeaf/Firefly\)[ \t]*"
)
README_COPYRIGHT_APPEND = (
    "- Modified by [E-Mufeng](https://github.com/E-Mufeng) <chenormonsters@gmail.com>"
)

# LICENSE：仅修改版权所有者行，保留完整 MIT 协议正文。
LICENSE_ANCHOR = "Copyright (c) 2025 CuteLeaf"
LICENSE_REPLACEMENT = (
    "Copyright (c) 2025 CuteLeaf; Modified by E-Mufeng <chenormonsters@gmail.com>"
)


def is_binary(path: Path) -> bool:
    """通过扩展名和文件头 NUL 字节识别二进制文件。"""
    if path.suffix.lower() in BINARY_EXTS:
        return True
    try:
        with path.open("rb") as fp:
            head = fp.read(8192)
        return b"\x00" in head
    except OSError:
        return True


def iter_text_files(root: Path):
    """递归遍历文本文件，自动跳过缓存目录和二进制文件。"""
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.name in SKIP_FILES or path.name == ".DS_Store":
            continue
        if is_binary(path):
            continue
        yield path


def read_text(path: Path) -> tuple[str | None, str | None]:
    """读取文本，优先 UTF-8，兼容 GB18030 和 Latin-1。"""
    try:
        data = path.read_bytes()
    except OSError:
        return None, None
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig"), "utf-8-sig"
    for encoding in ("utf-8", "gb18030", "latin-1"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return None, None


def write_text(path: Path, text: str, encoding: str | None) -> None:
    """按原编码写回，保留 BOM。"""
    if encoding == "utf-8-sig":
        path.write_bytes(("\ufeff" + text).encode("utf-8"))
    else:
        path.write_text(text, encoding=encoding or "utf-8", newline="")


def detect_newline(text: str) -> str:
    """检测文件主要换行符。"""
    return "\r\n" if "\r\n" in text else "\n"


def apply_direct_replacements(line: str, skip_email: bool = False) -> str:
    """对单行应用有明确替换值的规则。"""
    for old, new in DIRECT_REPLACEMENTS:
        if skip_email and old == "xiaye@msn.com":
            continue
        line = line.replace(old, new)
    return line


def transform_text(text: str, rel_path: str) -> str:
    """执行完整替换，并处理版权/作者头部追加。"""
    new_text = text
    skip_email = rel_path in SOURCE_HEADER_APPENDS
    newline = detect_newline(text)

    # 1. 源代码头部：保留原作者行并追加修改署名。
    if rel_path in SOURCE_HEADER_APPENDS and MODIFIED_MARK not in new_text:
        cfg = SOURCE_HEADER_APPENDS[rel_path]
        if cfg["anchor"] in new_text:
            new_text = new_text.replace(
                cfg["anchor"],
                cfg["anchor"] + newline + cfg["append"],
                1,
            )

    # 2. README 版权行追加修改署名（必须在仓库 URL 替换之前，保证能匹配原行）。
    if rel_path in README_COPYRIGHT_APPENDS and MODIFIED_MARK not in new_text:
        match = README_COPYRIGHT_PATTERN.search(new_text)
        if match:
            new_text = new_text.replace(
                match.group(0),
                match.group(0) + newline + README_COPYRIGHT_APPEND,
                1,
            )

    # 3. 有明确替换值的元信息。
    for old, new in DIRECT_REPLACEMENTS:
        if skip_email and old == "xiaye@msn.com":
            continue
        new_text = new_text.replace(old, new)

    # 4. LICENSE 版权所有者行。
    if rel_path == "LICENSE" and LICENSE_ANCHOR in new_text:
        new_text = new_text.replace(LICENSE_ANCHOR, LICENSE_REPLACEMENT, 1)

    return new_text


def md_cell(value: str, limit: int = 220) -> str:
    """转义 Markdown 表格字符并限制单格长度。"""
    value = value.replace("|", "\\|").replace("\r", " ").replace("\n", " ")
    if len(value) > limit:
        value = value[:limit] + "..."
    return value


def collect_rows(text: str, rel_path: str) -> list[dict]:
    """收集当前文件的逐行对照记录。"""
    rows: list[dict] = []
    skip_email = rel_path in SOURCE_HEADER_APPENDS

    for lineno, raw_line in enumerate(text.splitlines(keepends=True), 1):
        line = raw_line.rstrip("\r\n")
        new_line = apply_direct_replacements(line, skip_email)
        if new_line != line:
            rows.append(
                {
                    "status": "直接替换",
                    "file": rel_path,
                    "line": lineno,
                    "old": line,
                    "new": new_line,
                }
            )

        manual_hits = [p for p in MANUAL_PATTERNS if p in line]
        if manual_hits:
            rows.append(
                {
                    "status": "人工复核",
                    "file": rel_path,
                    "line": lineno,
                    "old": line,
                    "new": line,
                    "note": "；".join(manual_hits),
                }
            )

    newline = detect_newline(text)
    if rel_path in SOURCE_HEADER_APPENDS and MODIFIED_MARK not in text:
        cfg = SOURCE_HEADER_APPENDS[rel_path]
        if cfg["anchor"] in text:
            rows.append(
                {
                    "status": "保留原版权，追加修改署名",
                    "file": rel_path,
                    "line": "头部",
                    "old": cfg["anchor"],
                    "new": cfg["anchor"] + newline + cfg["append"],
                }
            )

    if rel_path == "LICENSE" and LICENSE_ANCHOR in text:
        rows.append(
            {
                "status": "仅修改版权所有者行",
                "file": rel_path,
                "line": "头部",
                "old": LICENSE_ANCHOR,
                "new": LICENSE_REPLACEMENT,
            }
        )

    if rel_path in README_COPYRIGHT_APPENDS and MODIFIED_MARK not in text:
        match = README_COPYRIGHT_PATTERN.search(text)
        if match:
            rows.append(
                {
                    "status": "保留原版权，追加修改署名",
                    "file": rel_path,
                    "line": "版权行",
                    "old": match.group(0).strip(),
                    "new": match.group(0).strip()
                    + newline
                    + README_COPYRIGHT_APPEND,
                }
            )

    return rows


def write_report(report_path: Path, rows: list[dict], dry_run: bool) -> None:
    """生成 Markdown 对照报告。"""
    mode = "dry-run 预览" if dry_run else "真实替换结果"
    lines = [
        f"# Firefly 作者信息替换对照表（{mode}）",
        "",
        f"生成时间：{datetime.datetime.now().isoformat(timespec='seconds')}",
        "",
        "| 状态 | 文件 | 位置 | 原文 | 替换后 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        note = f"【人工复核：{row.get('note', '')}】" if row["status"] == "人工复核" else ""
        lines.append(
            "| "
            + " | ".join(
                [
                    row["status"],
                    row["file"],
                    str(row["line"]),
                    md_cell(row["old"]),
                    md_cell(row["new"]) + note,
                ]
            )
            + " |"
        )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Firefly 作者信息批量替换脚本")
    parser.add_argument("--apply", action="store_true", help="执行真实写入；默认只做 dry-run")
    parser.add_argument("--root", default=str(PROJECT_ROOT), help="项目根目录")
    parser.add_argument(
        "--report",
        default=str(PROJECT_ROOT / "author_replacement_report.md"),
        help="对照报告输出路径",
    )
    parser.add_argument(
        "--log",
        default=str(PROJECT_ROOT / "author_replace_log.txt"),
        help="改动日志输出路径",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    report_path = Path(args.report)
    log_path = Path(args.log)
    dry_run = not args.apply

    all_rows: list[dict] = []
    changed_files = 0
    affected_files = 0
    scanned_files = 0
    log_lines = []
    timestamp = datetime.datetime.now().isoformat(timespec="seconds")

    for path in iter_text_files(root):
        text, encoding = read_text(path)
        if text is None:
            continue
        scanned_files += 1
        rel_path = path.relative_to(root).as_posix()
        rows = collect_rows(text, rel_path)
        new_text = transform_text(text, rel_path)
        if rows:
            affected_files += 1
            all_rows.extend(rows)
        if new_text != text:
            changed_files += 1
            if dry_run:
                log_lines.append(f"{timestamp} [DRY-RUN] {rel_path}: {len(rows)} 处待处理")
            else:
                write_text(path, new_text, encoding)
                log_lines.append(f"{timestamp} [APPLY] {rel_path}: {len(rows)} 处已替换")
        elif rows:
            log_lines.append(f"{timestamp} [SCAN] {rel_path}: {len(rows)} 处仅人工复核，不写入")

    auto_count = sum(1 for r in all_rows if r["status"] in {"直接替换", "保留原版权，追加修改署名", "仅修改版权所有者行"})
    manual_count = sum(1 for r in all_rows if r["status"] == "人工复核")

    write_report(report_path, all_rows, dry_run)
    log_lines.append(
        f"{timestamp} 扫描 {scanned_files} 个文本文件；"
        f"{affected_files} 个文件涉及作者信息；"
        f"{changed_files} 个文件将自动替换；"
        f"自动替换 {auto_count} 处；人工复核 {manual_count} 处。"
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fp:
        fp.write("\n".join(log_lines) + "\n")

    print(f"扫描文本文件: {scanned_files}")
    print(f"涉及作者信息的文件: {affected_files}")
    print(f"将自动替换的文件: {changed_files}")
    print(f"自动替换/追加署名: {auto_count} 处")
    print(f"人工复核: {manual_count} 处")
    print(f"对照报告: {report_path}")
    print(f"日志: {log_path}")
    if dry_run:
        print("当前为 dry-run，未写入任何文件；确认无误后执行: python scripts/replace_author_info.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
