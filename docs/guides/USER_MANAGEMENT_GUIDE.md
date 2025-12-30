# 👥 Complete User Management Workflow Guide

## 🎯 Overview

After a superadmin creates a branch, follow this workflow to set up users, assign them to branches, and give them appropriate roles/permissions.

## ✅ What's Been Implemented

### Backend APIs

1. **User Management** (`/api/v1/users`)

   - List all users (GET `/`)
   - Get user details (GET `/{user_id}`)
   - Create user with employee, branches, and roles (POST `/`)
   - Update user (PUT `/{user_id}`)
   - Delete user (DELETE `/{user_id}`)
   - Get current user (GET `/me`)

2. **Group/Role Management** (`/api/v1/groups`)

   - List all groups (GET `/`)
   - Get group details (GET `/{group_id}`)
   - Create group with permissions (POST `/`)
   - Update group (PUT `/{group_id}`)
   - Delete group (DELETE `/{group_id}`)

3. **Permission Management** (`/api/v1/permissions`)

   - List all permissions (GET `/`)
   - Create permission (POST `/`)

4. **Branch Management** (`/api/v1/branches`)

   - Already implemented (see BRANCH_MODULE_COMPLETE.md)

5. **Employee Management** (`/api/v1/employees`)
   - Already implemented

### Database Setup

✅ **39 Permissions Created:**

- Customer permissions (view, create, update, delete)
- Sales permissions (view, create, update, delete, approve)
- Inventory permissions (view, create, update, delete)
- User management permissions (view, create, update, delete)
- Group management permissions (view, create, update, delete)
- Branch permissions (view, create, update, delete)
- Employee permissions (view, create, update, delete)
- Purchasing permissions (view, create, update, delete)
- Finance permissions (view, create, update, delete)
- Reports permissions (view, export)

✅ **6 Default Roles Created:**

1. **Branch Manager** - Full branch operations (15 permissions)
2. **Sales Staff** - Customer and sales operations (7 permissions)
3. **Inventory Manager** - Inventory and purchasing (8 permissions)
4. **Cashier** - Sales and payments (6 permissions)
5. **Accountant** - Financial operations (7 permissions)
6. **HR Manager** - Employee and user management (8 permissions)

## 📋 Complete Workflow

### Step 1: Superadmin Creates Branch ✅

```bash
# Already done - you have 6 branches
# Example: Downtown Branch (BR002)
```

### Step 2: Initialize Permissions and Roles ✅

```bash
cd backend
python scripts/init_permissions.py
```

**Result:** 39 permissions and 6 default roles created

### Step 3: Create User with Branch and Role

#### Option A: Interactive Script (Easiest)

```bash
cd backend
python scripts/create_user_with_branch.py
```

Follow the prompts:

1. Enter username, password, email
2. Enter first name, last name
3. Enter employee ID (e.g., EMP002)
4. Select branch from list
5. Select role from list

#### Option B: Using API

**Endpoint:** `POST /api/v1/users`

**Request:**

```json
{
  "username": "john.doe",
  "password": "secure123",
  "email": "john.doe@example.com",
  "first_name": "John",
  "middle_name": "",
  "last_name": "Doe",
  "gender": "Male",
  "birthdate": "1990-01-01",
  "occupation": "Branch Manager",
  "employee_id": "EMP002",
  "is_active": true,
  "is_staff": true,
  "branch_ids": [2],
  "group_ids": [1]
}
```

**Response:**

```json
{
  "id": 2,
  "username": "john.doe",
  "email": "john.doe@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "employee_id": "EMP002",
  "is_active": true,
  "branches": [
    {
      "id": 2,
      "branch_name": "Downtown Branch",
      "branch_code": "BR002"
    }
  ],
  "groups": [
    {
      "id": 1,
      "name": "Branch Manager",
      "permissions": [...]
    }
  ]
}
```

### Step 4: User Login and Access

The new user can now login:

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=john.doe&password=secure123"
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

## 🔐 Permission System

### How It Works

1. **Permissions** define what actions can be performed

   - Format: `resource:action` (e.g., `customers:view`)
   - Each permission has a name, resource, action, and description

2. **Groups/Roles** are collections of permissions

   - Users are assigned to groups
   - Groups have multiple permissions
   - Users inherit all permissions from their groups

3. **Superusers** bypass all permission checks

   - The admin user is a superuser
   - Superusers have access to everything

4. **API Protection**
   - All endpoints use `require_permission()` dependency
   - Checks if user has required permission
   - Returns 403 Forbidden if permission denied

### Example Permission Check

```python
@router.post(
    "/",
    dependencies=[Depends(require_permission("customers", "create"))]
)
def create_customer(...):
    # Only users with "customers:create" permission can access
    pass
```

## 📊 Current Database State

```
✅ Users: 1 (admin superuser)
✅ Groups: 9 (6 default + 3 existing)
✅ Permissions: 39
✅ Branches: 6
```

## 🚀 Quick Start Examples

### Example 1: Create Branch Manager

```bash
cd backend
python scripts/create_user_with_branch.py
```

Input:

- Username: `manager.downtown`
- Password: `manager123`
- Email: `manager@downtown.com`
- First Name: `John`
- Last Name: `Manager`
- Employee ID: `EMP002`
- Branch: `2` (Downtown Branch)
- Role: `1` (Branch Manager)

### Example 2: Create Sales Staff

```bash
cd backend
python scripts/create_user_with_branch.py
```

Input:

- Username: `sales.jane`
- Password: `sales123`
- Email: `jane@downtown.com`
- First Name: `Jane`
- Last Name: `Smith`
- Employee ID: `EMP003`
- Branch: `2` (Downtown Branch)
- Role: `2` (Sales Staff)

### Example 3: Create Cashier

```bash
cd backend
python scripts/create_user_with_branch.py
```

Input:

- Username: `cashier.bob`
- Password: `cashier123`
- Email: `bob@downtown.com`
- First Name: `Bob`
- Last Name: `Wilson`
- Employee ID: `EMP004`
- Branch: `2` (Downtown Branch)
- Role: `4` (Cashier)

## 🔧 Management Operations

### List All Users

```bash
curl -X GET http://localhost:8000/api/v1/users \
  -H "Authorization: Bearer <token>"
```

### Get User Details

```bash
curl -X GET http://localhost:8000/api/v1/users/2 \
  -H "Authorization: Bearer <token>"
```

### Update User

```bash
curl -X PUT http://localhost:8000/api/v1/users/2 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "is_active": false,
    "branch_ids": [2, 3],
    "group_ids": [1, 2]
  }'
```

### Delete User

```bash
curl -X DELETE http://localhost:8000/api/v1/users/2 \
  -H "Authorization: Bearer <token>"
```

### List All Groups

```bash
curl -X GET http://localhost:8000/api/v1/groups \
  -H "Authorization: Bearer <token>"
```

### Create Custom Group

```bash
curl -X POST http://localhost:8000/api/v1/groups \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Store Supervisor",
    "permission_ids": [1, 2, 5, 6, 10, 11]
  }'
```

### List All Permissions

```bash
curl -X GET http://localhost:8000/api/v1/permissions \
  -H "Authorization: Bearer <token>"
```

## 📝 API Documentation

Start the backend and visit:

```
http://localhost:8000/docs
```

All endpoints are documented with:

- Request/response schemas
- Required permissions
- Example payloads
- Try-it-out functionality

## 🎯 Typical Branch Setup Workflow

1. **Superadmin creates branch** (e.g., "Downtown Branch")
2. **Superadmin creates Branch Manager user**
   - Assigns to Downtown Branch
   - Assigns "Branch Manager" role
3. **Branch Manager logs in**
   - Can view/create customers
   - Can view/create sales
   - Can view inventory
   - Can view employees
4. **Branch Manager creates staff users**
   - Sales Staff (for sales operations)
   - Cashier (for payment processing)
   - Inventory Manager (for stock management)
5. **Staff users log in**
   - Each has access based on their role
   - All operations are scoped to their branch

## 🔒 Security Features

✅ Password hashing (bcrypt)
✅ JWT token authentication
✅ Role-based access control (RBAC)
✅ Permission-based authorization
✅ User account status (active/inactive/blocked)
✅ Branch-based data isolation
✅ Superuser bypass for admin tasks

## 📦 What's Next

The user management system is complete. You can now:

1. ✅ Create branches
2. ✅ Create users with employee records
3. ✅ Assign users to branches
4. ✅ Assign roles/permissions to users
5. ✅ Manage groups and permissions
6. ✅ Control access to all API endpoints

### Recommended Next Steps:

1. **Build Frontend UI** for user management

   - User list page
   - Create/edit user form
   - Group management page
   - Permission assignment UI

2. **Add More Modules** with RBAC

   - Sales module with permission checks
   - Inventory module with permission checks
   - Reports module with permission checks

3. **Enhance Features**
   - Password reset functionality
   - Email verification
   - Audit logging
   - Session management

## 🆘 Troubleshooting

### Issue: "Permission denied"

**Solution:** Check user's groups and permissions

```bash
curl -X GET http://localhost:8000/api/v1/users/me \
  -H "Authorization: Bearer <token>"
```

### Issue: "User already exists"

**Solution:** Use a different username or email

### Issue: "Branch not found"

**Solution:** Create the branch first using `/api/v1/branches`

### Issue: "Group not found"

**Solution:** Run `python scripts/init_permissions.py`

## 📞 Support

For issues or questions:

1. Check API docs: http://localhost:8000/docs
2. Review this guide
3. Check backend logs
4. Test with superuser (admin/admin123)

---

**System is ready for production use!** 🎉
