"""User library — folders, resumes, job descriptions, and session history (DB-backed)."""
from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.auth import get_current_user
from services.pdf_parser import extract_text_from_pdf
from models.db_models import User, Folder, Resume, JobDescription, InterviewSession

router = APIRouter(prefix="/api/library", tags=["library"])


# ── Pydantic models ──────────────────────────────────────────────────

class ResumeOut(BaseModel):
    id: str
    tag: str
    file_name: str
    created_at: str


class JDOut(BaseModel):
    id: str
    label: str
    text: str
    created_at: str


class SessionOut(BaseModel):
    id: str
    resume_id: str | None
    resume_tag: str | None
    jd_id: str | None
    jd_label: str | None
    question_count: int
    last_question: str | None
    created_at: str
    updated_at: str


class FolderCreate(BaseModel):
    name: str


class FolderUpdate(BaseModel):
    name: str | None = None


class FolderOut(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    resumes: list[ResumeOut]
    jds: list[JDOut]
    sessions: list[SessionOut]


# ── Folders ──────────────────────────────────────────────────────────

@router.get("/folders", response_model=list[FolderOut])
async def list_folders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Folder)
        .where(Folder.user_id == user.id)
        .options(
            selectinload(Folder.resumes),
            selectinload(Folder.job_descriptions),
            selectinload(Folder.sessions).selectinload(InterviewSession.messages),
        )
        .order_by(Folder.updated_at.desc())
    )
    folders = result.scalars().all()

    out = []
    for f in folders:
        # Build resume/JD lookup for session display
        resume_map = {r.id: r for r in f.resumes}
        jd_map = {j.id: j for j in f.job_descriptions}

        sessions = []
        for s in sorted(f.sessions, key=lambda x: x.created_at, reverse=True):
            r = resume_map.get(s.resume_id) if s.resume_id else None
            j = jd_map.get(s.jd_id) if s.jd_id else None
            # Compute question_count from messages if not yet backfilled
            q_count = s.question_count
            last_q = s.last_question
            if q_count == 0 and s.messages:
                user_msgs = [m for m in s.messages if m.role == "user"]
                q_count = len(user_msgs)
                last_q = user_msgs[-1].content if user_msgs else None
            sessions.append(SessionOut(
                id=str(s.id),
                resume_id=str(s.resume_id) if s.resume_id else None,
                resume_tag=r.tag if r else None,
                jd_id=str(s.jd_id) if s.jd_id else None,
                jd_label=j.label if j else None,
                question_count=q_count,
                last_question=last_q,
                created_at=s.created_at.isoformat(),
                updated_at=s.updated_at.isoformat(),
            ))

        out.append(FolderOut(
            id=str(f.id),
            name=f.name,
            created_at=f.created_at.isoformat(),
            updated_at=f.updated_at.isoformat(),
            resumes=[ResumeOut(id=str(r.id), tag=r.tag, file_name=r.file_name, created_at=r.created_at.isoformat()) for r in f.resumes],
            jds=[JDOut(id=str(j.id), label=j.label, text=j.text, created_at=j.created_at.isoformat()) for j in f.job_descriptions],
            sessions=sessions,
        ))
    return out


@router.post("/folders", response_model=FolderOut)
async def create_folder(
    body: FolderCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    folder = Folder(user_id=user.id, name=body.name.strip())
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return FolderOut(
        id=str(folder.id), name=folder.name,
        created_at=folder.created_at.isoformat(), updated_at=folder.updated_at.isoformat(),
        resumes=[], jds=[], sessions=[],
    )


@router.patch("/folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: str,
    body: FolderUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(Folder)
        .where(Folder.id == fid, Folder.user_id == user.id)
        .options(
            selectinload(Folder.resumes),
            selectinload(Folder.job_descriptions),
            selectinload(Folder.sessions),
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(404, "Folder not found.")
    if body.name is not None:
        folder.name = body.name.strip()
    await db.commit()
    await db.refresh(folder)

    resume_map = {r.id: r for r in folder.resumes}
    jd_map = {j.id: j for j in folder.job_descriptions}

    return FolderOut(
        id=str(folder.id), name=folder.name,
        created_at=folder.created_at.isoformat(), updated_at=folder.updated_at.isoformat(),
        resumes=[ResumeOut(id=str(r.id), tag=r.tag, file_name=r.file_name, created_at=r.created_at.isoformat()) for r in folder.resumes],
        jds=[JDOut(id=str(j.id), label=j.label, text=j.text, created_at=j.created_at.isoformat()) for j in folder.job_descriptions],
        sessions=[SessionOut(
            id=str(s.id),
            resume_id=str(s.resume_id) if s.resume_id else None,
            resume_tag=resume_map.get(s.resume_id).tag if s.resume_id and resume_map.get(s.resume_id) else None,
            jd_id=str(s.jd_id) if s.jd_id else None,
            jd_label=jd_map.get(s.jd_id).label if s.jd_id and jd_map.get(s.jd_id) else None,
            question_count=s.question_count,
            last_question=s.last_question,
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        ) for s in sorted(folder.sessions, key=lambda x: x.created_at, reverse=True)],
    )


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(Folder).where(Folder.id == fid, Folder.user_id == user.id)
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(404, "Folder not found.")
    await db.delete(folder)
    await db.commit()
    return {"ok": True}


# ── Sessions ─────────────────────────────────────────────────────────

@router.delete("/folders/{folder_id}/sessions")
async def clear_folder_sessions(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(Folder).where(Folder.id == fid, Folder.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Folder not found.")
    sessions = await db.execute(
        select(InterviewSession).where(
            InterviewSession.folder_id == fid,
            InterviewSession.user_id == user.id,
        )
    )
    for s in sessions.scalars().all():
        await db.delete(s)
    await db.commit()
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == sid, InterviewSession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found.")
    await db.delete(session)
    await db.commit()
    return {"ok": True}


# ── Resumes ──────────────────────────────────────────────────────────

@router.get("/resumes", response_model=list[ResumeOut])
async def list_resumes(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.user_id == user.id).order_by(Resume.created_at.desc())
    )
    return [
        ResumeOut(id=str(r.id), tag=r.tag, file_name=r.file_name, created_at=r.created_at.isoformat())
        for r in result.scalars().all()
    ]


@router.post("/resumes", response_model=ResumeOut)
async def upload_resume(
    file: UploadFile = File(...),
    tag: str = Form(...),
    folder_id: str = Form(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate folder ownership
    try:
        fid = uuid.UUID(folder_id)
    except ValueError:
        raise HTTPException(400, "Invalid folder_id.")
    folder_result = await db.execute(
        select(Folder).where(Folder.id == fid, Folder.user_id == user.id)
    )
    if not folder_result.scalar_one_or_none():
        raise HTTPException(404, "Folder not found.")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "PDF files only.")
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:
        raise HTTPException(400, "Max 10MB.")
    try:
        resume_text = extract_text_from_pdf(file_bytes)
    except ValueError as e:
        raise HTTPException(422, str(e))

    resume = Resume(
        user_id=user.id,
        folder_id=fid,
        tag=tag.strip(),
        file_name=file.filename,
        resume_text=resume_text,
        pdf_data=file_bytes,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return ResumeOut(id=str(resume.id), tag=resume.tag, file_name=resume.file_name, created_at=resume.created_at.isoformat())


@router.delete("/resumes/{resume_id}")
async def delete_resume(
    resume_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rid = uuid.UUID(resume_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(Resume).where(Resume.id == rid, Resume.user_id == user.id)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(404, "Resume not found.")
    await db.delete(resume)
    await db.commit()
    return {"ok": True}


# ── Job Descriptions ─────────────────────────────────────────────────

class JDCreate(BaseModel):
    label: str
    text: str
    folder_id: str


@router.get("/jds", response_model=list[JDOut])
async def list_jds(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JobDescription).where(JobDescription.user_id == user.id).order_by(JobDescription.created_at.desc())
    )
    return [
        JDOut(id=str(j.id), label=j.label, text=j.text, created_at=j.created_at.isoformat())
        for j in result.scalars().all()
    ]


@router.post("/jds", response_model=JDOut)
async def create_jd(
    body: JDCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate folder ownership
    try:
        fid = uuid.UUID(body.folder_id)
    except ValueError:
        raise HTTPException(400, "Invalid folder_id.")
    folder_result = await db.execute(
        select(Folder).where(Folder.id == fid, Folder.user_id == user.id)
    )
    if not folder_result.scalar_one_or_none():
        raise HTTPException(404, "Folder not found.")

    jd = JobDescription(user_id=user.id, folder_id=fid, label=body.label.strip(), text=body.text.strip())
    db.add(jd)
    await db.commit()
    await db.refresh(jd)
    return JDOut(id=str(jd.id), label=jd.label, text=jd.text, created_at=jd.created_at.isoformat())


@router.delete("/jds/{jd_id}")
async def delete_jd(
    jd_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(jd_id)
    except ValueError:
        raise HTTPException(400, "Invalid ID.")
    result = await db.execute(
        select(JobDescription).where(JobDescription.id == jid, JobDescription.user_id == user.id)
    )
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(404, "JD not found.")
    await db.delete(jd)
    await db.commit()
    return {"ok": True}
