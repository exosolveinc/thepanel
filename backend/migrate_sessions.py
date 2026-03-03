"""
One-time migration: add folder_id, question_count, last_question to interview_sessions.
Run: python migrate_sessions.py
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
        # Add folder_id column
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE interview_sessions
                    ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))

        # Add question_count column
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE interview_sessions
                    ADD COLUMN question_count INTEGER NOT NULL DEFAULT 0;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))

        # Add last_question column
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE interview_sessions
                    ADD COLUMN last_question TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))

        # Backfill question_count and last_question from messages
        await conn.execute(text("""
            UPDATE interview_sessions s
            SET question_count = sub.cnt,
                last_question = sub.last_q
            FROM (
                SELECT session_id,
                       COUNT(*) AS cnt,
                       (ARRAY_AGG(content ORDER BY created_at DESC))[1] AS last_q
                FROM messages
                WHERE role = 'user'
                GROUP BY session_id
            ) sub
            WHERE s.id = sub.session_id AND s.question_count = 0;
        """))

        # Backfill folder_id from resume's folder
        await conn.execute(text("""
            UPDATE interview_sessions s
            SET folder_id = r.folder_id
            FROM resumes r
            WHERE s.resume_id = r.id AND s.folder_id IS NULL AND r.folder_id IS NOT NULL;
        """))

    print("Migration complete: interview_sessions updated with folder_id, question_count, last_question.")


if __name__ == "__main__":
    asyncio.run(migrate())
