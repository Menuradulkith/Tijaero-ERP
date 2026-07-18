from pydantic_settings import BaseSettings
from typing import List, Union
import json
from app.common.base_models import AuditMixin

class Settings(BaseSettings, AuditMixin):
    PROJECT_NAME: str = "ERP System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Timezone for all ERP operations (system local time)
    TIMEZONE: str = "Asia/Colombo"
    
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    BACKEND_CORS_ORIGINS: Union[List[str], str] = ["http://localhost:3000"]
    
    # Email Settings
    ENABLE_EMAIL_SERVICE: bool = False
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    
    # AI Chat Agent (OpenAI)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_BASE_URL: str = ""  # optional override for the OpenAI-compatible endpoint
    CHAT_AGENT_MONTHLY_BUDGET_USD: float = 50.0
    CHAT_AGENT_INPUT_COST_PER_1M: float = 2.50   # gpt-4o input $/1M tokens
    CHAT_AGENT_OUTPUT_COST_PER_1M: float = 10.00  # gpt-4o output $/1M tokens
    CHAT_AGENT_MAX_TOOL_ROUNDS: int = 6
    CHAT_AGENT_HISTORY_MESSAGES: int = 20
    # Content moderation: screen each user message through OpenAI's (free)
    # moderation endpoint before it reaches the model/tool loop. Fails OPEN
    # (allows the message, logs a warning) if the check itself errors, so a
    # moderation outage never disables the assistant.
    CHAT_AGENT_MODERATION_ENABLED: bool = True
    CHAT_AGENT_MODERATION_MODEL: str = "omni-moderation-latest"
    # Sanity ceiling on the monetary amount of any AI-proposed financial write
    # (expense, bank deposit, …). A defence-in-depth guard against a
    # hallucinated or injection-induced absurd amount slipping past the human
    # confirmation card. Does not affect the normal REST API.
    CHAT_AGENT_MAX_WRITE_AMOUNT: float = 100_000_000.0
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore" 
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if isinstance(self.BACKEND_CORS_ORIGINS, str):
            try:
                self.BACKEND_CORS_ORIGINS = json.loads(self.BACKEND_CORS_ORIGINS)
            except json.JSONDecodeError:
                self.BACKEND_CORS_ORIGINS = [
                    origin.strip() 
                    for origin in self.BACKEND_CORS_ORIGINS.split(",")
                ]

settings = Settings()
