from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str
    anthropic_api_key: str
    deepgram_api_key: str = ""

    # AWS Bedrock (for Titan Embeddings)
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

    # Supabase pgvector
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Model routing
    groq_fast_model: str = "llama-3.1-8b-instant"                          # classification
    groq_main_model: str = "llama-3.3-70b-versatile"                       # basic Q&A + design structure
    claude_sonnet_model: str = "claude-sonnet-4-6"                         # drill-down (direct API)
    claude_opus_model: str = "claude-opus-4-6"                             # deep technical (direct API)
    bedrock_claude_model: str = "us.anthropic.claude-opus-4-6-v1"            # HMV/HMT overview+code (Bedrock inference profile)

    # Session
    max_history_turns: int = 10

    # CORS / WebSocket origin allowlists (comma-separated)
    cors_allow_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000"
    ws_allowed_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000"

    # Logging + timeouts
    log_level: str = "INFO"
    llm_total_timeout_seconds: float = 90.0
    pdf_parse_timeout_seconds: float = 30.0

    class Config:
        env_file = ".env"


settings = Settings()
