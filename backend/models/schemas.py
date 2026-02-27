from pydantic import BaseModel
from typing import Optional
from enum import Enum


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


class AskRequest(BaseModel):
    session_id: str
    question: str
    mode: AnswerMode = AnswerMode.QUICK


class DrillRequest(BaseModel):
    session_id: str
    component_id: str
    component_name: str
    context: str
    depth: int = 1
