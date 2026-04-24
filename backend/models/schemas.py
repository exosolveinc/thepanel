from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum


class ErrorResponse(BaseModel):
    message: str
    code: Optional[str] = None


class QuestionType(str, Enum):
    BASIC = "basic"
    BEHAVIORAL = "behavioral"
    SYSTEM_DESIGN = "system_design"


class AnswerMode(str, Enum):
    QUICK = "quick"    # Short, highlighted key points
    LONG = "long"      # TL;DR + full elaboration
    DESIGN = "design"  # Force system design diagram


class DesignComponent(BaseModel):
    id: str
    name: str
    description: str
    tech: list[str] = []
    x: float = 0
    y: float = 0


class DesignConnection(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None


class DesignStructure(BaseModel):
    title: str
    summary: str
    components: list[DesignComponent]
    connections: list[DesignConnection]


class SessionResponse(BaseModel):
    session_id: str
    message: str


class SessionRequest(BaseModel):
    session_id: str = Field(..., min_length=1)


class AskRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=10000)
    mode: AnswerMode = AnswerMode.QUICK


class DrillRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    component_id: str = Field(..., min_length=1)
    component_name: str = Field(..., min_length=1)
    context: str = Field(default="")
    depth: int = Field(default=1, ge=1, le=5)


class FollowUpsRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=10000)
    answer: str = Field(..., min_length=1, max_length=20000)


# ── Practice / Coding / Deep-dive / Arch-flow request schemas ──────────

class QuestionsRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    count: int = Field(default=10, ge=1, le=50)
    question_type: Literal["behavioral", "technical", "mixed"] = "mixed"


class EvaluateRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=10000)
    answer: str = Field(..., min_length=1, max_length=20000)
    difficulty: str = Field(default="medium", max_length=32)


class SummaryRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    qa_pairs: list[dict] = Field(..., max_length=100)


class ProblemRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    difficulty: str = Field(default="easy", max_length=32)


class EvaluateCodeRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    problem_title: str = Field(..., min_length=1, max_length=200)
    problem_description: str = Field(..., min_length=1, max_length=5000)
    code: str = Field(..., min_length=1, max_length=50_000)
    language: str = Field(default="python", max_length=20)


class DeepDiveRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    topic: str = Field(..., min_length=1, max_length=10000)


class ArchFlowRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=10000)
