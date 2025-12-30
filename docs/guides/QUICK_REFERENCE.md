# Permission System - Quick Reference Card

## ✅ YES - Backend Checks Permissions!

```
Frontend (UX) + Backend (Security) = Complete Protection
```

## Quick Facts

| Aspect                   | Details                                  |
| ------------------------ | ---------------------------------------- |
| **Backend Enforcement**  | ✅ Every API endpoint checks permissions |
| **Frontend Filtering**   | ✅ Sidebar hides unauthorized items      |
| **Can Bypass Frontend?** | ❌ No - Backend blocks with 403          |
| **Superuser Access**     | ✅ Full access to everything             |
| **Permission Source**    | Database (groups + direct permissions)   |

## Common Use Cases

### Hide Button Without Permission

```typescript
<PermissionGuard resource="customers" action="create">
  <Button>Create Customer</Button>
</PermissionGuard>
```

### Check Permission in Code

```typescript
const canDelete = usePermission("customers", "delete");
if (canDelete) {
  // Show delete button
}
```

### Protect Route

```typescript
<Route
  path="/admin"
  element={
    <ProtectedRoute resource="admin" action="view">
      <AdminPage />
    </ProtectedRoute>
  }
/>
```

## Testing

### Verify Backend Returns Permissions

```bash
cd backend
python test_permissions_response.py
```

### Check User Data in Browser

```javascript
// In browser console
const user = JSON.parse(localStorage.getItem("auth-storage"));
console.log(user.state.user.groups);
```

## Files to Know

### Backend

- `backend/app/auth/rbac.py` - Permission logic
- `backend/app/auth/models.py` - User/Group/Permission models

### Frontend

- `frontend/src/auth/permissions.ts` - Permission helpers
- `frontend/src/auth/components/PermissionGuard.tsx` - UI protection
- `frontend/src/app/layout/Sidebar.tsx` - Menu filtering

## Documentation

- **`PERMISSION_SYSTEM_SUMMARY.md`** - Complete overview
- **`PERMISSION_BACKEND_VERIFICATION.md`** - Backend testing guide
- **`frontend/PERMISSIONS.md`** - Frontend usage guide

## Support

If permissions not working:

1. Check user has groups assigned
2. Check groups have permissions
3. Run test script: `python backend/test_permissions_response.py`
4. Check browser console for user data
5. Verify backend returns groups with permissions
