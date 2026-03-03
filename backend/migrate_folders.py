"""One-time migration: add folders table and folder_id to resumes/job_descriptions."""
import asyncio
from sqlalchemy import text
from database import engine, async_session_factory, Base
from models.db_models import User, Folder, Resume, JobDescription  # noqa: F401


async def migrate():
    # Ensure all tables exist (creates folders table if missing)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add folder_id columns if they don't exist (for existing databases)
    async with engine.begin() as conn:
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE resumes ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))
        await conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE job_descriptions ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        """))

    # Create "General" folder for each user with orphaned resumes or JDs
    async with async_session_factory() as db:
        users_with_orphans = await db.execute(text("""
            SELECT DISTINCT u.id FROM users u
            WHERE EXISTS (SELECT 1 FROM resumes r WHERE r.user_id = u.id AND r.folder_id IS NULL)
               OR EXISTS (SELECT 1 FROM job_descriptions j WHERE j.user_id = u.id AND j.folder_id IS NULL)
        """))
        for (user_id,) in users_with_orphans:
            folder = Folder(user_id=user_id, name="General")
            db.add(folder)
            await db.flush()
            await db.execute(text(
                "UPDATE resumes SET folder_id = :fid WHERE user_id = :uid AND folder_id IS NULL"
            ), {"fid": folder.id, "uid": user_id})
            await db.execute(text(
                "UPDATE job_descriptions SET folder_id = :fid WHERE user_id = :uid AND folder_id IS NULL"
            ), {"fid": folder.id, "uid": user_id})
            print(f"Created 'General' folder for user {user_id} (folder_id={folder.id})")
        await db.commit()

    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
