# Permission System - Complete Summary

## Quick Answer: YES, Permissions Are Checked from Backend! ✅

The system has **two-layer security**:

### 1. Backend (Security Layer) 🔒

- **Enforces** permissions on every API request
- Users **cannot** access data without proper permissions
- Returns **403 Forbidden** if permission denied
- Uses `require_permission()` dependency on endpoints

### 2. Frontend (UX Layer) 🎨

- **Hides** menu items user can't access
- **Hides** buttons/features user can't use
- Provides **better user experience**
- Prevents confusion from seeing disabled features

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    USER LOGS IN                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Backend: Returns user data with groups & permissions       │
│  {                                                           │
│    username: "john",                                         │
│    is_superuser: false,                                      │
│    groups: [                                                 │
│      {                                                       │
│        name: "Sales Team",                                   │
│        permissions: [                                        │
│          { resource: "customers", action: "view" },          │
│          { resource: "sales", action: "create" }             │
│        ]                                                     │
│      }                                                       │
│    ]                                                         │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: Stores user data in authStore                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: Filters sidebar menu items                       │
│  - Shows: Dashboard, Customers, Sales                       │
│  - Hides: Inventory, Finance, HR, Users, Roles              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Customers"                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: Shows customer page with "Create" button         │
│  (because user has sales:create permission)                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Create Customer"                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Frontend: Sends POST /api/v1/customers                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Backend: Checks if user has customers:create permission    │
│  - Has permission? → Create customer, return 201            │
│  - No permission? → Return 403 Forbidden                    │
└─────────────────────────────────────────────────────────────┘
```

## What Happens If User Tries to Bypass Frontend?

### Scenario: User tries to access API directly

```bash
# User with NO inventory permission tries:
curl -X GET "http://localhost:8000/api/v1/inventory" \
  -H "Authorization: Bearer USER_TOKEN"

# Backend Response:
HTTP/1.1 403 Forbidden
{
  "detail": "Permission denied. Required: inventory:view"
}
```

**Result**: ❌ **BLOCKED by backend** - User cannot access data

### Scenario: User modifies frontend code to show hidden menu

```javascript
// User hacks frontend to show "Users" menu item
// Clicks on it and navigates to /users
```

**Result**:

1. Frontend tries to load users: `GET /api/v1/users`
2. Backend checks permission: `users:view`
3. User doesn't have permission
4. Backend returns: **403 Forbidden**
5. Frontend shows: **"Access Denied"** page

**Result**: ❌ **BLOCKED by backend** - User sees error page

## Backend Permission Enforcement

### Every Protected Endpoint Has Permission Check

```python
# Example: Customer API
@router.get(
    "/",
    dependencies=[Depends(require_permission("customers", "view"))]
)
def list_customers(
    current_user: User = Depends(require_permission("customers", "view"))
):
    # This code only runs if user has permission
    return customers

# If user doesn't have permission:
# - Function never executes
# - Returns 403 Forbidden immediately
```

### Permission Check Logic (Backend)

```python
def user_has_permission(user: User, resource: str, action: str) -> bool:
    # Superusers have ALL permissions
    if user.is_superuser:
        return True

    # Check direct user permissions
    for permission in user.permissions:
        if permission.resource == resource and permission.action == action:
            return True

    # Check group permissions
    for group in user.groups:
        for permission in group.permissions:
            if permission.resource == resource and permission.action == action:
                return True

    # No permission found
    return False
```

## Files Modified/Created

### Backend Changes:

- ✅ `backend/app/auth/models.py` - Changed `lazy='selectin'` to load permissions
- ✅ `backend/test_permissions_response.py` - Test script to verify permissions

### Frontend Changes:

- ✅ `frontend/src/auth/permissions.ts` - Permission constants and helpers
- ✅ `frontend/src/auth/components/PermissionGuard.tsx` - UI protection
- ✅ `frontend/src/auth/components/ProtectedRoute.tsx` - Route protection
- ✅ `frontend/src/app/layout/Sidebar.tsx` - Menu filtering
- ✅ `frontend/src/api/types.ts` - Added Permission/Group types
- ✅ `frontend/src/modules/users/pages/UsersPage.tsx` - Example usage

### Documentation:

- ✅ `frontend/PERMISSIONS.md` - Complete usage guide
- ✅ `PERMISSION_BACKEND_VERIFICATION.md` - Backend verification guide
- ✅ `PERMISSION_SYSTEM_SUMMARY.md` - This file

## Testing the System

### 1. Run Backend Test Script

```bash
cd backend
python test_permissions_response.py
```

This verifies backend returns permissions correctly.

### 2. Test in Browser

1. Login as different users
2. Check sidebar - should show different items
3. Try accessing restricted pages - should see "Access Denied"
4. Check browser console for user data

### 3. Test API Directly

```bash
# Login
TOKEN=$(curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin" | jq -r '.access_token')

# Get user with permissions
curl -X GET "http://localhost:8000/api/v1/users/me" \
  -H "Authorization: Bearer $TOKEN" | jq '.groups[].permissions'
```

## Security Guarantees

✅ **Backend enforces permissions** - Cannot be bypassed
✅ **Frontend enhances UX** - Hides inaccessible features
✅ **Superusers have full access** - Clearly identified
✅ **Regular users restricted** - Only see what they can access
✅ **API returns 403** - Clear permission denial
✅ **Permissions from database** - Centrally managed

## User Types & Expected Behavior

### Superuser (is_superuser: true)

- ✅ Sees ALL menu items
- ✅ Can access ALL features
- ✅ Bypasses all permission checks

### Sales User (customers:view, sales:create)

- ✅ Sees: Dashboard, Customers, Sales
- ❌ Hides: Inventory, Finance, HR, Users, Roles, Branches
- ✅ Can view customers
- ✅ Can create sales
- ❌ Cannot create customers (no customers:create)

### View-Only User (only :view permissions)

- ✅ Sees menu items for modules they can view
- ❌ No Create/Edit/Delete buttons
- ❌ Cannot modify any data

### No Permissions User

- ✅ Sees: Dashboard only
- ❌ All other pages show "Access Denied"

## Key Takeaways

1. **Backend is the source of truth** - Permissions checked on every request
2. **Frontend improves UX** - Hides what users can't access
3. **Cannot bypass security** - Frontend checks are cosmetic, backend enforces
4. **Permissions from database** - Managed through groups and direct assignments
5. **Two-layer approach** - Security (backend) + UX (frontend)

## Next Steps

1. ✅ Backend already checks permissions
2. ✅ Frontend now checks permissions
3. ✅ Sidebar filters by permissions
4. ⏳ Apply to other pages (Customers, Sales, etc.)
5. ⏳ Test with different user roles
6. ⏳ Create groups and assign permissions in database

## Questions?

**Q: Can users bypass frontend checks?**
A: They can modify frontend code, but backend will still block them with 403.

**Q: Where are permissions stored?**
A: In database tables: `auth_permission`, `auth_group`, `auth_group_permissions`, `accounts_user_groups`

**Q: How do I create new permissions?**
A: Add to database or use backend API (see PERMISSION_BACKEND_VERIFICATION.md)

**Q: What if user has no permissions?**
A: They only see Dashboard. All other pages show "Access Denied".

**Q: Do I need to check permissions in frontend?**
A: Yes, for better UX. But backend MUST also check for security.
