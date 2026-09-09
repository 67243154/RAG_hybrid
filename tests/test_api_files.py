from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.security.auth import DEFAULT_DEV_TOKENS, TokenAuthenticator
from app.shared.config import Settings
from app.shared.slug import slugify
from app.sync.models import STATUS_SUCCESS, SyncRunResult


class _StubManager:
    known_source_types = ["filesystem"]

    def __init__(self) -> None:
        self.sync_calls: list[tuple[str, str]] = []

    def is_running(self, source_type: str) -> bool:
        return False

    async def trigger_sync(self, source_type: str, trigger: str) -> SyncRunResult:
        self.sync_calls.append((source_type, trigger))
        return SyncRunResult(
            source_type=source_type,
            status=STATUS_SUCCESS,
            run_id=1,
            stats=None,
            error=None,
            trace_id="trace-1",
        )


class _StubHistory:
    def list_runs(self, source_type=None, limit=50):
        return []


class _StubRegistry:
    def list_documents(self, tenant_id=None, source_type=None):
        return []


def _client(docs_dir: Path, *, authenticated: bool = False) -> tuple[TestClient, _StubManager]:
    manager = _StubManager()
    settings = Settings(_env_file=None, filesystem_root_path=str(docs_dir))
    client = TestClient(
        create_app(
            manager,
            _StubHistory(),
            _StubRegistry(),
            settings=settings,
            auth_enabled=authenticated,
            token_authenticator=(
                TokenAuthenticator(DEFAULT_DEV_TOKENS) if authenticated else None
            ),
            tenant_ids={"filesystem": "tenant-a" if authenticated else "local-dev"},
        )
    )
    return client, manager


def test_operator_can_upload_supported_file_and_trigger_sync(tmp_path):
    client, manager = _client(tmp_path, authenticated=True)

    response = client.post(
        "/files",
        files={"file": ("员工手册.md", b"# rules\n", "text/markdown")},
        headers={"Authorization": "Bearer token-operator-a"},
    )

    assert response.status_code == 201
    assert (tmp_path / "员工手册.md").read_bytes() == b"# rules\n"
    assert response.json()["source_id"] == slugify("员工手册.md", strip_extension=False)
    assert response.json()["sync"]["status"] == STATUS_SUCCESS
    assert manager.sync_calls == [("filesystem", "manual")]


def test_upload_refuses_overwrite_and_unsupported_extension(tmp_path):
    (tmp_path / "existing.md").write_text("original", encoding="utf-8")
    client, manager = _client(tmp_path)

    duplicate = client.post(
        "/files", files={"file": ("existing.md", b"replacement", "text/markdown")}
    )
    unsupported = client.post(
        "/files", files={"file": ("notes.txt", b"text", "text/plain")}
    )

    assert duplicate.status_code == 409
    assert unsupported.status_code == 415
    assert (tmp_path / "existing.md").read_text(encoding="utf-8") == "original"
    assert manager.sync_calls == []


def test_upload_refuses_empty_or_path_like_filename(tmp_path):
    client, _ = _client(tmp_path)

    empty = client.post(
        "/files", files={"file": ("empty.md", b"", "text/markdown")}
    )
    path_like = client.post(
        "/files", files={"file": ("../escape.md", b"unsafe", "text/markdown")}
    )

    assert empty.status_code == 400
    assert path_like.status_code == 400
    assert not (tmp_path.parent / "escape.md").exists()


def test_operator_can_delete_exact_file_and_trigger_sync(tmp_path):
    document = tmp_path / "员工手册.pdf"
    document.write_bytes(b"pdf")
    client, manager = _client(tmp_path, authenticated=True)
    source_id = slugify(document.name, strip_extension=False)

    response = client.delete(
        f"/files/{source_id}",
        headers={"Authorization": "Bearer token-operator-a"},
    )

    assert response.status_code == 200
    assert response.json()["filename"] == document.name
    assert not document.exists()
    assert manager.sync_calls == [("filesystem", "manual")]


def test_plain_user_cannot_upload_or_delete(tmp_path):
    document = tmp_path / "private.md"
    document.write_text("protected", encoding="utf-8")
    client, manager = _client(tmp_path, authenticated=True)
    headers = {"Authorization": "Bearer token-user-a"}

    upload = client.post(
        "/files",
        files={"file": ("new.md", b"new", "text/markdown")},
        headers=headers,
    )
    delete = client.delete(
        f"/files/{slugify(document.name, strip_extension=False)}", headers=headers
    )

    assert upload.status_code == 403
    assert delete.status_code == 403
    assert document.exists()
    assert manager.sync_calls == []
