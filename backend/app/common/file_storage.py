"""
Minimal local-disk file storage for user-uploaded images (e.g. supplier
logos, company logo). Not a general attachment system — just enough to
save an image under app.core.config.settings.UPLOAD_DIR and serve it back
via the /uploads static route mounted in app.main.

Usage:
    from app.common.file_storage import save_image, delete_file

    relative_path = save_image(upload_file, subdir="suppliers")
    # ... store `relative_path` on the model ...
    delete_file(old_relative_path)  # when replacing/removing
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}


# The declared Content-Type is client-controlled, so also check the file's own
# magic bytes: a script/HTML/PHP payload cannot be stored under an image type.
_SVG_FORBIDDEN = re.compile(
    rb"<\s*script|<\s*foreignObject|<\s*iframe|<\s*embed|<\s*object|<!ENTITY|"
    rb"\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text/html|(?:xlink:)?href\s*=\s*[\"']\s*https?:",
    re.IGNORECASE,
)


def _matches_signature(content_type: str, data: bytes) -> bool:
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if content_type == "image/svg+xml":
        head = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
        return (head.startswith(b"<svg") or head.startswith(b"<?xml") or head.startswith(b"<!--") or head.startswith(b"<!doctype svg")) \
            and b"<svg" in data[:4096].lower() and not _SVG_FORBIDDEN.search(data)
    return False


def _upload_root() -> Path:
    root = Path(settings.UPLOAD_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def save_image(file: UploadFile, subdir: str, allow_svg: bool = True) -> str:
    """Validate and save an uploaded image; returns its path relative to
    the upload root (e.g. "suppliers/3f9c2a1e.png"), suitable for storing
    on a model column and for building a public URL as f"/uploads/{path}".
    """
    extension = ALLOWED_IMAGE_CONTENT_TYPES.get(file.content_type)
    if file.content_type == "image/svg+xml" and not allow_svg:
        extension = None
    if not extension:
        allowed = "PNG, JPEG, WEBP, SVG" if allow_svg else "PNG, JPEG, WEBP"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type '{file.content_type}'. Allowed: {allowed}.",
        )

    contents = file.file.read()
    if len(contents) > settings.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size is {settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB.",
        )
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
    if not _matches_signature(file.content_type, contents):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The file content does not match its declared image type (or contains active content).",
        )

    dest_dir = _upload_root() / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{extension}"
    dest_path = dest_dir / filename
    dest_path.write_bytes(contents)

    return f"{subdir}/{filename}"


def delete_file(relative_path: str | None) -> None:
    """Best-effort delete of a previously saved file. Never raises — a
    missing file (already deleted, moved storage, etc.) is not an error."""
    if not relative_path:
        return
    try:
        path = (_upload_root() / relative_path).resolve()
        upload_root = _upload_root().resolve()
        if upload_root in path.parents and path.is_file():
            path.unlink()
    except OSError:
        pass
