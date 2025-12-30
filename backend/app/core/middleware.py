from fastapi import FastAPI, Request
from app.core.logging import logger
import time

async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    logger.info(f"{request.method} {request.url.path} - {response.status_code} - {process_time:.2f}s")
    return response

def setup_middleware(app: FastAPI):
    app.middleware("http")(log_requests)
