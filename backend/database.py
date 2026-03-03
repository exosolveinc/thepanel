"""Async database engine and session factory."""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from config import settings

# Auto-fix driver: Supabase gives postgresql:// but we need asyncpg
_url = settings.database_url
if _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+asyncpg://", 1)

_is_supabase = "supabase" in _url
_connect_args = {"ssl": "require", "prepared_statement_cache_size": 0} if _is_supabase else {}
engine = create_async_engine(_url, echo=False, connect_args=_connect_args, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI dependency — yields an async DB session."""
    async with async_session_factory() as session:
        yield session


async def create_tables():
    """Create all tables if they don't exist. Called on startup."""
    from models.db_models import User, Folder, Resume, JobDescription, InterviewSession, Message  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
