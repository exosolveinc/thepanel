from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from utils.logging import setup_logging, get_logger
from routers import session, interview, deep_dive, arch_flow, practice, code_practice
from routers import hm, stt

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_logging(settings.log_level)
    checks = {
        "GROQ_API_KEY": bool(settings.groq_api_key),
        "ANTHROPIC_API_KEY": bool(settings.anthropic_api_key),
        "DEEPGRAM_API_KEY": bool(settings.deepgram_api_key),
        "AWS_ACCESS_KEY_ID": bool(settings.aws_access_key_id),
        "AWS_SECRET_ACCESS_KEY": bool(settings.aws_secret_access_key),
        "SUPABASE_URL": bool(settings.supabase_url),
        "SUPABASE_SERVICE_KEY": bool(settings.supabase_service_key),
    }
    missing = [k for k, v in checks.items() if not v]
    if missing:
        for key in missing:
            logger.warning("%s is not configured — related features will be unavailable", key)
    else:
        logger.info("All API keys and services configured")
    yield


app = FastAPI(title="The Panel — Interview Assistant", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router)
app.include_router(interview.router)
app.include_router(deep_dive.router)
app.include_router(arch_flow.router)
app.include_router(practice.router)
app.include_router(code_practice.router)
app.include_router(hm.router)
app.include_router(stt.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "services": {
            "groq": bool(settings.groq_api_key),
            "anthropic": bool(settings.anthropic_api_key),
            "deepgram": bool(settings.deepgram_api_key),
            "aws_bedrock": bool(settings.aws_access_key_id and settings.aws_secret_access_key),
            "supabase": bool(settings.supabase_url and settings.supabase_service_key),
        },
    }
