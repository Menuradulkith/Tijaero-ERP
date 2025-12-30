def test_get_current_user(client):
    response = client.get("/api/v1/users/me")
    assert response.status_code in [200, 401]
