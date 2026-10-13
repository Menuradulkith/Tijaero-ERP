"""Security headers for API responses (QA audit 2026-10-11, finding 17).

Pure ASGI so streaming/GZip responses are untouched. Only paths under the API
prefix get headers; /uploads (own nosniff + CSP) and /docs are left alone.
Authenticated requests (Authorization header) and the auth endpoints also get
Cache-Control: no-store so tokens and personal data are not cached.
"""


class SecurityHeadersMiddleware:
    def __init__(self, app, api_prefix: str = "/api/"):
        self.app = app
        self.api_prefix = api_prefix

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.api_prefix):
            await self.app(scope, receive, send)
            return
        authed = any(k == b"authorization" for k, _ in scope.get("headers", []))

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                extra = [(b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY")]
                content_type = next((v for k, v in headers if k.lower() == b"content-type"), b"")
                if (authed or scope["path"].startswith(self.api_prefix + "v1/auth")) and b"json" in content_type.lower():
                    extra.append((b"cache-control", b"no-store"))
                headers.extend((k, v) for k, v in extra if k not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)
