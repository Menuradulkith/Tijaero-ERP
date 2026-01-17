from fastapi import APIRouter
from datetime import datetime

router = APIRouter()

@router.get(
    "",
    summary="Health Check",
    description="Check API health status",
    responses={
        200: {"description": "API is healthy"},
    }
)
def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }
