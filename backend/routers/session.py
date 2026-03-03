import uuid as _uuid
from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from models.schemas import SessionResponse
from models.db_models import User, Resume, JobDescription, Folder, InterviewSession, Message
from services.session_store import create_session
from services.pdf_parser import extract_text_from_pdf
from services.auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/session", tags=["session"])


# ── Pydantic response models ─────────────────────────────────────────

class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    message_type: str | None = None
    mode: str | None = None
    design_data: dict | None = None
    created_at: str


class SessionDetail(BaseModel):
    session_id: str
    resume_id: str | None = None
    resume_tag: str | None = None
    jd_id: str | None = None
    jd_label: str | None = None
    folder_id: str | None = None
    instructions: str | None = None
    messages: list[MessageOut]


@router.post("", response_model=SessionResponse)
async def create_interview_session(
    job_description: str = Form(...),
    resume: UploadFile = File(None),
    resume_id: str = Form(""),
    jd_id: str = Form(""),
    folder_id: str = Form(""),
    instructions: str = Form(""),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Resolve resume text — either from uploaded file or saved resume
    resume_text = ""
    r_id = None

    if resume_id:
        # Use a saved resume from DB
        try:
            r_id = _uuid.UUID(resume_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid resume_id.")
        result = await db.execute(
            select(Resume).where(Resume.id == r_id, Resume.user_id == user.id)
        )
        saved = result.scalar_one_or_none()
        if not saved:
            raise HTTPException(status_code=404, detail="Saved resume not found.")
        resume_text = saved.resume_text
    elif resume:
        # Upload a new resume
        if not resume.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Resume must be a PDF file.")
        file_bytes = await resume.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Resume PDF must be under 10MB.")
        try:
            resume_text = extract_text_from_pdf(file_bytes)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail="Provide either a resume file or resume_id.")

    if not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description cannot be empty.")

    # Resolve optional jd_id
    j_id = None
    if jd_id:
        try:
            j_id = _uuid.UUID(jd_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid jd_id.")
        result = await db.execute(
            select(JobDescription).where(JobDescription.id == j_id, JobDescription.user_id == user.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Saved JD not found.")

    # Resolve optional folder_id
    f_id = None
    if folder_id:
        try:
            f_id = _uuid.UUID(folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid folder_id.")
        result = await db.execute(
            select(Folder).where(Folder.id == f_id, Folder.user_id == user.id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Folder not found.")

    session = await create_session(
        db=db,
        user_id=user.id,
        resume_text=resume_text,
        job_description=job_description.strip(),
        resume_id=r_id,
        jd_id=j_id,
        folder_id=f_id,
        instructions=instructions.strip(),
    )
    return SessionResponse(session_id=session.session_id, message="Session created. Ready for questions.")


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session_detail(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Load a previous session with all its messages."""
    try:
        sid = _uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id.")

    result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.id == sid, InterviewSession.user_id == user.id)
        .options(selectinload(InterviewSession.messages))
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    # Resolve resume tag and JD label
    resume_tag = None
    if session.resume_id:
        r = await db.execute(select(Resume).where(Resume.id == session.resume_id))
        resume = r.scalar_one_or_none()
        if resume:
            resume_tag = resume.tag

    jd_label = None
    if session.jd_id:
        j = await db.execute(select(JobDescription).where(JobDescription.id == session.jd_id))
        jd = j.scalar_one_or_none()
        if jd:
            jd_label = jd.label

    return SessionDetail(
        session_id=str(session.id),
        resume_id=str(session.resume_id) if session.resume_id else None,
        resume_tag=resume_tag,
        jd_id=str(session.jd_id) if session.jd_id else None,
        jd_label=jd_label,
        folder_id=str(session.folder_id) if session.folder_id else None,
        instructions=session.instructions or None,
        messages=[
            MessageOut(
                id=str(m.id),
                role=m.role,
                content=m.content,
                message_type=m.message_type,
                mode=m.mode,
                design_data=m.design_data,
                created_at=m.created_at.isoformat(),
            )
            for m in sorted(session.messages, key=lambda x: x.created_at)
        ],
    )
