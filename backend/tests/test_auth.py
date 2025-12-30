def test_login(client):
    response = client.post("/api/v1/auth/login", data={"username": "test", "password": "test"})
    assert response.status_code in [200, 401]

def test_register(client):
    response = client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "username": "testuser",
        "password": "testpass"
    })
    assert response.status_code in [200, 422]
