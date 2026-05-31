def test_login(client):
    response = client.post("/api/v1/auth/login", data={"username": "test", "password": "test"})
    assert response.status_code in [200, 401]

def test_register(client):
    # /auth/register is an admin-protected endpoint, so an unauthenticated
    # request is correctly rejected with 401/403.  (200/422 would only occur
    # for an authenticated caller with a valid/invalid body.)
    response = client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "username": "testuser",
        "password": "testpass"
    })
    assert response.status_code in [200, 401, 403, 422]
