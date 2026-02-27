from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from models.schemas import SessionResponse
from services.session_store import create_session
from services.pdf_parser import extract_text_from_pdf

router = APIRouter(prefix="/api/session", tags=["session"])


@router.post("", response_model=SessionResponse)
async def create_interview_session(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
):
    if not resume.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Resume must be a PDF file.")

    file_bytes = await resume.read()
    if len(file_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="Resume PDF must be under 10MB.")

    try:
        resume_text = extract_text_from_pdf(file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description cannot be empty.")

    session = create_session(resume_text=resume_text, job_description=job_description.strip())
    return SessionResponse(session_id=session.session_id, message="Session created. Ready for questions.")
