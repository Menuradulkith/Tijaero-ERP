from pydantic_settings import BaseSettings
from typing import List, Union
import json

class Settings(BaseSettings):
    PROJECT_NAME: str = "ERP System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Timezone for all ERP operations (Sri Lanka Standard Time)
    TIMEZONE: str = "Asia/Colombo"
    
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    BACKEND_CORS_ORIGINS: Union[List[str], str] = ["http://localhost:3000"]
    
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
