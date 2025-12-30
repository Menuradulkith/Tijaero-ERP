# 🚀 Quick Reference: After Creating a Branch

## ⚡ Fast Track

### 1️⃣ Initialize System (One Time Only)

```bash
cd backend
python scripts/init_permissions.py
```

✅ Creates 39 permissions and 6 default roles

### 2️⃣ Create User for Branch

```bash
cd backend
python scripts/create_user_with_branch.py
```

Follow prompts to create user with:

- Username & password
- Employee ID
- Branch assignment
- Role assignment

### 3️⃣ User Can Login

```
URL: http://localhost:3000
Username: [created username]
Password: [created password]
```

## 📊 Default Roles & Permissions

| Role                  | Permissions    | Use Case               |
| --------------------- | -------------- | ---------------------- |
| **Branch Manager**    | 15 permissions | Full branch operations |
| **Sales Staff**       | 7 permissions  | Customer & sales       |
| **Inventory Manager** | 8 permissions  | Stock & purchasing     |
| **Cashier**           | 6 permissions  | Sales & payments       |
| **Accountant**        | 7 permissions  | Financial records      |
| **HR Manager**        | 8 permissions  | Employee management    |

## 🔑 API Endpoints

### Authentication

```bash
POST /api/v1/auth/login
POST /api/v1/auth/register
```

### Users

```bash
GET    /api/v1/users          # List all
GET    /api/v1/users/me       # Current user
GET    /api/v1/users/{id}     # Get one
POST   /api/v1/users          # Create
PUT    /api/v1/users/{id}     # Update
DELETE /api/v1/users/{id}     # Delete
```

### Groups/Roles

```bash
GET    /api/v1/groups         # List all
GET    /api/v1/groups/{id}    # Get one
POST   /api/v1/groups         # Create
PUT    /api/v1/groups/{id}    # Update
DELETE /api/v1/groups/{id}    # Delete
```

### Permissions

```bash
GET    /api/v1/permissions    # List all
POST   /api/v1/permissions    # Create
```

### Branches

```bash
GET    /api/v1/branches       # List all
GET    /api/v1/branches/{id}  # Get one
POST   /api/v1/branches       # Create
PUT    /api/v1/branches/{id}  # Update
DELETE /api/v1/branches/{id}  # Delete
```

## 💡 Common Scenarios

### Scenario 1: New Branch Setup

```
1. Superadmin creates branch → "Downtown Branch"
2. Run: python scripts/create_user_with_branch.py
3. Create Branch Manager → john.manager
4. Branch Manager logs in
5. Branch Manager creates staff users via API
```

### Scenario 2: Add Sales Staff

```
1. Run: python scripts/create_user_with_branch.py
2. Select "Sales Staff" role
3. User can now handle customers and sales
```

### Scenario 3: Custom Role

```bash
# Create custom role via API
curl -X POST http://localhost:8000/api/v1/groups \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Store Supervisor",
    "permission_ids": [1,2,5,6,10,11]
  }'
```

## 🎯 Permission Format

```
resource:action

Examples:
- customers:view
- customers:create
- sales:view
- sales:create
- inventory:update
```

## 📋 Create User JSON Example

```json
{
  "username": "john.doe",
  "password": "secure123",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "gender": "Male",
  "birthdate": "1990-01-01",
  "occupation": "Manager",
  "employee_id": "EMP002",
  "is_active": true,
  "is_staff": true,
  "branch_ids": [2],
  "group_ids": [1]
}
```

## 🔍 Check System Status

```bash
cd backend
python -c "
from app.db.session import SessionLocal
from app.auth.models import User, Group, Permission, Branch

db = SessionLocal()
print(f'Users: {db.query(User).count()}')
print(f'Groups: {db.query(Group).count()}')
print(f'Permissions: {db.query(Permission).count()}')
print(f'Branches: {db.query(Branch).count()}')
db.close()
"
```

## 🆘 Quick Fixes

### Reset Admin Password

```bash
cd backend
python simple_reset_password.py
```

### Check Users

```bash
cd backend
python simple_user_check.py
```

### View API Docs

```
http://localhost:8000/docs
```

## 📱 Current System State

```
✅ Users: 1 (admin)
✅ Groups: 9 (6 default roles)
✅ Permissions: 39
✅ Branches: 6
✅ APIs: All user management endpoints ready
```

## 🎉 You're Ready!

The complete user management system is implemented and ready to use. Create users, assign them to branches, give them roles, and they can start working!
