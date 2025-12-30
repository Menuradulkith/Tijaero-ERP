# Backend Permission Verification Guide

## Overview

Yes, **permissions ARE checked from the backend**. The system has a two-layer security approach:

1. **Backend (Security)**: Enforces permissions on API endpoints - users cannot access data they don't have permission for
2. **Frontend (UX)**: Hides UI elements users can't use - provides better user experience

## Backend Permission System

### How Backend Checks Permissions

Every protected API endpoint uses the `require_permission()` dependency:

```python
# Example from backend/app/modules/customers/api.py
@router.get(
    "/",
    dependencies=[Depends(require_permission(*Permissions.CUSTOMER_VIEW))]
)
def list_customers(
    current_user: User = Depends(require_permission(*Permissions.CUSTOMER_VIEW))
):
    # Only users with customers:view permission can access this
    return customers
```

### Permission Check Flow

```
API Request → JWT Token → Get User → Check Permission → Allow/Deny
                                            ↓
                                    User Groups + Direct Permissions
```

### Backend Files

- **`backend/app/auth/rbac.py`**: Permission checking logic
- **`backend/app/auth/models.py`**: User, Group, Permission models
- **`backend/app/auth/service.py`**: User/Group/Permission management
- **`backend/app/auth/schemas.py`**: API response schemas

## Verifying Backend Returns Permissions

### Method 1: Test Script

Run the provided test script:

```bash
cd backend
python test_permissions_response.py
```

This will:

1. Login with credentials
2. Fetch user data from `/users/me`
3. Display groups and permissions
4. Save full response to `user_response.json`

### Method 2: Manual API Test

1. **Login to get token**:

```bash
curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin"
```

Response:

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer"
}
```

2. **Get current user with permissions**:

```bash
curl -X GET "http://localhost:8000/api/v1/users/me" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Expected response:

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "is_superuser": true,
  "groups": [
    {
      "id": 1,
      "name": "Administrators",
      "permissions": [
        {
          "id": 1,
          "name": "View Customers",
          "resource": "customers",
          "action": "view"
        },
        {
          "id": 2,
          "name": "Create Customers",
          "resource": "customers",
          "action": "create"
        }
      ]
    }
  ],
  "permissions": []
}
```

### Method 3: Browser DevTools

1. Open browser DevTools (F12)
2. Go to Network tab
3. Login to the application
4. Find the request to `/api/v1/users/me`
5. Check the response - should include `groups` with `permissions`

## What Was Changed in Backend

### 1. Updated Relationship Loading

Changed from `lazy='select'` to `lazy='selectin'` for better nested loading:

```python
# backend/app/auth/models.py

class User(Base, TimestampMixin):
    # Changed to selectin for eager loading
    groups = relationship("Group", secondary=user_groups, back_populates="users", lazy='selectin')
    permissions = relationship("Permission", secondary=user_permissions, back_populates="users", lazy='selectin')
    branches = relationship("Branch", secondary=user_branches, back_populates="users", lazy='selectin')

class Group(Base, TimestampMixin):
    # Changed to selectin to load permissions with groups
    permissions = relationship("Permission", secondary=group_permissions, back_populates="groups", lazy='selectin')
```

**Why?** `selectin` loads related data in a single query, ensuring permissions are included when user data is serialized.

## Expected User Response Structure

```typescript
{
  id: number;
  username: string;
  email: string;
  is_superuser: boolean;
  is_active: boolean;
  first_name: string;
  last_name: string;
  groups: [
    {
      id: number;
      name: string;
      permissions: [
        {
          id: number;
          name: string;
          resource: string;  // e.g., "customers"
          action: string;     // e.g., "view"
          description?: string;
        }
      ]
    }
  ];
  permissions: []; // Direct user permissions (usually empty)
  branches: [...];
}
```

## Testing Permission Enforcement

### Test 1: Access Without Permission

1. Create a user with NO permissions
2. Try to access `/api/v1/customers`
3. Should get **403 Forbidden** response

```bash
# Should fail with 403
curl -X GET "http://localhost:8000/api/v1/customers" \
  -H "Authorization: Bearer LIMITED_USER_TOKEN"
```

### Test 2: Access With Permission

1. Create a user with `customers:view` permission
2. Try to access `/api/v1/customers`
3. Should get **200 OK** with customer data

### Test 3: Frontend Hides UI

1. Login as limited user
2. Sidebar should NOT show "Customers" menu item
3. Trying to navigate to `/customers` directly should show "Access Denied"

## Common Issues & Solutions

### Issue 1: User has no permissions in response

**Symptoms**: `groups` array is empty or groups have no `permissions`

**Solutions**:

1. Check if user is assigned to groups in database
2. Check if groups have permissions assigned
3. Verify relationships are loading (check backend logs)
4. Run test script to see actual response

**Fix**:

```sql
-- Check user groups
SELECT * FROM accounts_user_groups WHERE user_id = 1;

-- Check group permissions
SELECT * FROM auth_group_permissions WHERE group_id = 1;

-- Check permissions exist
SELECT * FROM auth_permission;
```

### Issue 2: Permissions not loading in nested groups

**Symptoms**: Groups appear but `permissions` array is empty

**Solution**: Already fixed by changing `lazy='selectin'` in models

### Issue 3: Frontend shows all menu items

**Symptoms**: User sees all navigation items regardless of permissions

**Possible causes**:

1. User is superuser (intentional - superusers see everything)
2. Frontend not checking permissions (check Sidebar.tsx)
3. User data not loaded properly (check authStore)

**Debug**:

```typescript
// In browser console
const user = JSON.parse(localStorage.getItem("auth-storage"));
console.log("User:", user.state.user);
console.log("Groups:", user.state.user?.groups);
```

## Security Best Practices

### ✅ DO:

- Always check permissions on backend endpoints
- Use `require_permission()` dependency for protected routes
- Return 403 Forbidden for unauthorized access
- Log permission denials for security auditing
- Test with users having different permission levels

### ❌ DON'T:

- Rely only on frontend permission checks
- Expose sensitive data in API responses
- Use permission checks only in UI (backend must enforce)
- Give users more permissions than needed
- Forget to check permissions on update/delete operations

## Permission Management

### Creating Permissions

```python
# In backend shell or migration
from app.auth.models import Permission
from app.db.session import SessionLocal

db = SessionLocal()

# Create permission
perm = Permission(
    name="View Customers",
    resource="customers",
    action="view",
    description="Allows viewing customer list and details"
)
db.add(perm)
db.commit()
```

### Assigning Permissions to Groups

```python
# Assign permissions to group
group = db.query(Group).filter(Group.name == "Sales Team").first()
permissions = db.query(Permission).filter(
    Permission.resource == "customers"
).all()
group.permissions = permissions
db.commit()
```

### Assigning Users to Groups

```python
# Assign user to group
user = db.query(User).filter(User.username == "john").first()
group = db.query(Group).filter(Group.name == "Sales Team").first()
user.groups.append(group)
db.commit()
```

## Monitoring & Debugging

### Enable Debug Logging

Add to backend logs to see permission checks:

```python
# In backend/app/auth/rbac.py
import logging
logger = logging.getLogger(__name__)

def user_has_permission(user: User, resource: str, action: str) -> bool:
    logger.info(f"Checking permission {resource}:{action} for user {user.username}")

    if user.is_superuser:
        logger.info(f"User {user.username} is superuser - access granted")
        return True

    # ... rest of the function
```

### Check Permission Denials

Look for 403 responses in backend logs:

```
INFO: 127.0.0.1:52000 - "GET /api/v1/customers HTTP/1.1" 403 Forbidden
```

## Summary

✅ **Backend DOES check permissions** - Every protected endpoint validates user permissions
✅ **Backend DOES return permissions** - `/users/me` includes groups with permissions
✅ **Frontend uses permissions** - For better UX (hiding inaccessible features)
✅ **Two-layer security** - Backend enforces, frontend enhances UX

The system is secure because:

1. Backend validates every request
2. Users cannot bypass frontend checks by calling API directly
3. Permissions are loaded from database on every request
4. Superusers are clearly identified and have full access
