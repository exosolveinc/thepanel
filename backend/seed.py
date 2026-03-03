"""Seed script — run once to insert the admin user."""
import asyncio
from sqlalchemy import select
from database import engine, async_session_factory, Base
from models.db_models import User
from services.auth import hash_password


async def seed():
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as db:
        result = await db.execute(select(User).where(User.email == "admin@example.com"))
        existing = result.scalar_one_or_none()
        if existing:
            print("Admin user already exists — skipping.")
            return

        admin = User(
            email="admin@example.com",
            password_hash=hash_password("admin123"),
            name="Sariph Shrestha",
        )
        db.add(admin)
        await db.commit()
        print(f"Seeded admin user: admin@example.com (id={admin.id})")


if __name__ == "__main__":
    asyncio.run(seed())
