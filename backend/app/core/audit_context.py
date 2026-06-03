import contextvars

# Context variable to hold the current user ID for auditing purposes during requests.
current_user_id: contextvars.ContextVar[int | None] = contextvars.ContextVar("current_user_id", default=None)
