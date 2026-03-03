"""
One-time migration: add instructions column to interview_sessions.
Run: python migrate_instructions.py
"""
import asyncio
from sqlalchemy import text
from database import engine, Base
from models.db_models import InterviewSession  # noqa: F401


async def migrate():
    # Ensure table schema is up to date for any brand-new DBs
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with engine.begin() as conn:
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE interview_sessions
                    ADD COLUMN instructions TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))

    print("Migration complete: interview_sessions now has instructions column.")


if __name__ == "__main__":
    asyncio.run(migrate())
