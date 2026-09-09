"""Authenticated management endpoints for the local filesystem connector."""

from __future__ import annotations

import os
import tempfile
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.api.deps import require_role
from app.api.sync import require_owned_source_type
from app.security.models import Role, UserContext
from app.shared.slug import slugify
from app.sync.manager import UnknownConnectorError
from app.sync.models import TRIGGER_MANUAL

router = APIRouter(prefix="/files", tags=["files"])

_SOURCE_TYPE = "filesystem"
_ALLOWED_EXTENSIONS = {".pdf", ".md"}
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_COPY_CHUNK_BYTES = 1024 * 1024


def _root(request: Request) -> Path:
    root = Path(request.app.state.settings.filesystem_root_path).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_filename(raw_name: str | None) -> str:
    if not raw_name or not raw_name.strip():
        raise HTTPException(status_code=400, detail="文件名不能为空")
    normalized = raw_name.replace("\\", "/")
    filename = normalized.rsplit("/", 1)[-1].strip()
    if filename != normalized or filename in {".", ".."} or any(
        ord(character) < 32 for character in filename
    ):
        raise HTTPException(status_code=400, detail="文件名不合法")
    if Path(filename).suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="仅支持 PDF 和 Markdown 文件")
    return filename


def _sync_body(result) -> dict:
    return {
        "source_type": result.source_type,
        "status": result.status,
        "run_id": result.run_id,
        "error": result.error,
        "stats": asdict(result.stats) if result.stats is not None else None,
        "trace_id": result.trace_id,
    }


async def _sync_filesystem(request: Request) -> dict:
    try:
        result = await request.app.state.sync_manager.trigger_sync(
            _SOURCE_TYPE, TRIGGER_MANUAL
        )
    except UnknownConnectorError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _sync_body(result)


def _authorize(request: Request, user: UserContext) -> None:
    require_owned_source_type(request, _SOURCE_TYPE, user)
    if _SOURCE_TYPE not in request.app.state.sync_manager.known_source_types:
        raise HTTPException(status_code=404, detail="本地文件来源未配置")


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_local_file(
    request: Request,
    file: UploadFile = File(...),
    user: UserContext = Depends(require_role(Role.OPERATOR)),
) -> dict:
    """Store one supported document atomically, then refresh its index."""
    _authorize(request, user)
    filename = _safe_filename(file.filename)
    root = _root(request)
    destination = root / filename
    temporary_path: Path | None = None
    size = 0

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=root, prefix=".upload-", suffix=".tmp", delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            while chunk := await file.read(_COPY_CHUNK_BYTES):
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="文件不能超过 50 MB")
                temporary.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="不能上传空文件")

        try:
            # A hard link publishes the completed temporary file atomically and
            # refuses to overwrite an existing document on both Linux and NTFS.
            os.link(temporary_path, destination)
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail="同名文件已存在") from exc
    finally:
        await file.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    sync = await _sync_filesystem(request)
    return {
        "action": "uploaded",
        "filename": filename,
        "source_id": slugify(filename, strip_extension=False),
        "size_bytes": size,
        "sync": sync,
    }


@router.delete("/{source_id}")
async def delete_local_file(
    source_id: str,
    request: Request,
    user: UserContext = Depends(require_role(Role.OPERATOR)),
) -> dict:
    """Delete the exact local file represented by a registry source ID."""
    _authorize(request, user)
    root = _root(request)
    matches = [
        path
        for path in root.iterdir()
        if path.is_file()
        and path.suffix.lower() in _ALLOWED_EXTENSIONS
        and slugify(path.name, strip_extension=False) == source_id
    ]
    if not matches:
        raise HTTPException(status_code=404, detail="本地文件不存在")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail="文件标识不唯一，已拒绝删除")

    deleted = matches[0]
    deleted.unlink()
    sync = await _sync_filesystem(request)
    return {
        "action": "deleted",
        "filename": deleted.name,
        "source_id": source_id,
        "sync": sync,
    }
