from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str
    anthropic_api_key: str

    # Model routing
    groq_fast_model: str = "llama-3.1-8b-instant"      # classification
    groq_main_model: str = "llama-3.3-70b-versatile"   # basic Q&A + design structure
    claude_sonnet_model: str = "claude-sonnet-4-6"      # drill-down
    claude_opus_model: str = "claude-opus-4-6"          # deep technical

    # Session
    max_history_turns: int = 10

    class Config:
        env_file = ".env"


settings = Settings()
