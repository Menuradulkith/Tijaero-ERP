# 🎭 Demo Users Guide

## ✅ Demo Users Created Successfully!

8 demo users have been created with different roles and branch assignments to showcase the complete ERP system functionality.

## 🔑 Login Credentials

### Branch Manager

```
Username: john.manager
Password: manager123
Role: Branch Manager
Branches: Head Office (HQ001)
Permissions: 15 (Full branch operations)
```

**Can do:**

- View/create/update customers
- View/create/update/approve sales
- View/create/update inventory
- View employees and users
- View branches
- View and export reports

---

### Sales Staff

```
Username: sarah.sales
Password: sales123
Role: Sales Staff
Branches: Head Office (HQ001)
Permissions: 7 (Customer and sales operations)
```

**Can do:**

- View/create/update customers
- View/create sales
- View inventory
- View reports

```
Username: james.sales
Password: sales123
Role: Sales Staff
Branches: Downtown Branch (DT001)
Permissions: 7 (Customer and sales operations)
```

**Can do:**

- Same as Sarah but for Downtown Branch

---

### Inventory Manager

```
Username: mike.inventory
Password: inventory123
Role: Inventory Manager
Branches: Head Office (HQ001), Downtown Branch (DT001)
Permissions: 8 (Stock and purchasing)
```

**Can do:**

- View/create/update inventory
- View/create/update purchasing
- View and export reports
- Works across 2 branches

---

### Cashier

```
Username: lisa.cashier
Password: cashier123
Role: Cashier
Branches: Head Office (HQ001)
Permissions: 6 (Sales and payments)
```

**Can do:**

- View customers
- View/create sales
- View inventory
- View/create finance records

```
Username: sophia.cashier
Password: cashier123
Role: Cashier
Branches: Downtown Branch (DT001)
Permissions: 6 (Sales and payments)
```

**Can do:**

- Same as Lisa but for Downtown Branch

---

### Accountant

```
Username: david.accountant
Password: accountant123
Role: Accountant
Branches: Head Office (HQ001), Downtown Branch (DT001), North Branch (NB001)
Permissions: 7 (Financial records)
```

**Can do:**

- View/create/update finance records
- View sales
- View purchasing
- View and export reports
- Works across 3 branches

---

### HR Manager

```
Username: emma.hr
Password: hr123
Role: HR Manager
Branches: Head Office (HQ001), Downtown Branch (DT001)
Permissions: 8 (Employee management)
```

**Can do:**

- View/create/update employees
- View/create/update users
- View and export reports
- Works across 2 branches

---

### Superadmin (Already Exists)

```
Username: admin
Password: admin123
Role: Superuser
Branches: All
Permissions: All (Bypass all permission checks)
```

**Can do:**

- Everything in the system
- Create branches
- Create users
- Manage roles and permissions
- Access all modules

---

## 📊 User Distribution by Branch

### Head Office (HQ001)

- John Manager (Branch Manager)
- Sarah Johnson (Sales Staff)
- Mike Wilson (Inventory Manager)
- Lisa Brown (Cashier)
- David Martinez (Accountant)
- Emma Davis (HR Manager)

### Downtown Branch (DT001)

- Mike Wilson (Inventory Manager)
- David Martinez (Accountant)
- Emma Davis (HR Manager)
- James Anderson (Sales Staff)
- Sophia Taylor (Cashier)

### North Branch (NB001)

- David Martinez (Accountant)

## 🎯 Testing Scenarios

### Scenario 1: Branch Manager Operations

1. Login as `john.manager`
2. View dashboard
3. Create a customer
4. Create a sale
5. Approve the sale
6. View reports

### Scenario 2: Sales Staff Operations

1. Login as `sarah.sales`
2. View customers
3. Create a new customer
4. Create a sale for the customer
5. Try to approve sale (should fail - no permission)
6. View sales report

### Scenario 3: Multi-Branch Access

1. Login as `mike.inventory`
2. Switch between Head Office and Downtown Branch
3. View inventory for each branch
4. Create purchase orders
5. View inventory reports

### Scenario 4: Cashier Operations

1. Login as `lisa.cashier`
2. View customers
3. Process a sale
4. Record payment
5. View daily sales

### Scenario 5: Accountant Operations

1. Login as `david.accountant`
2. Access all 3 branches
3. View financial records
4. Create expense entries
5. Generate financial reports

### Scenario 6: HR Manager Operations

1. Login as `emma.hr`
2. View employees
3. Create a new employee
4. Create user account for employee
5. Assign user to branch and role

### Scenario 7: Permission Testing

1. Login as `sarah.sales` (Sales Staff)
2. Try to access Users page (should fail)
3. Try to access Roles page (should fail)
4. Try to delete a customer (should fail)
5. Verify only allowed operations work

## 🔐 Security Features Demonstrated

### Role-Based Access Control (RBAC)

- Each user has specific permissions based on their role
- Users can only perform actions they're authorized for
- Superuser bypasses all permission checks

### Multi-Branch Access

- Users can be assigned to multiple branches
- Data access is scoped to assigned branches
- Cross-branch operations for managers and accountants

### User Status Management

- All users are active by default
- Users can be deactivated without deletion
- Blocked users cannot login

## 📱 How to Test

### 1. Start Backend

```bash
cd backend
poetry run uvicorn app.main:app --reload
```

### 2. Start Frontend

```bash
cd frontend
npm run dev
```

### 3. Login

```
URL: http://localhost:3000
Use any credentials from above
```

### 4. Test Features

- Navigate through different modules
- Try operations based on user role
- Test permission restrictions
- Switch between branches (if assigned to multiple)

## 🎨 UI Features to Test

### User Management Page (`/users`)

- View all 9 users (including admin)
- See user details, branches, and roles
- Edit user information
- Assign/remove branches
- Assign/remove roles
- Deactivate/activate users

### Roles Management Page (`/roles`)

- View all 6 default roles
- See permissions for each role
- Create custom roles
- Modify role permissions
- Delete roles

### Dashboard

- View summary statistics
- Quick access to modules
- Recent activities

### Sidebar Navigation

- All modules accessible
- Role-based menu items (future enhancement)
- Active page highlighting

## 📋 Quick Reference

| Username         | Password      | Role              | Branches            | Use Case               |
| ---------------- | ------------- | ----------------- | ------------------- | ---------------------- |
| admin            | admin123      | Superuser         | All                 | System administration  |
| john.manager     | manager123    | Branch Manager    | HQ001               | Branch operations      |
| sarah.sales      | sales123      | Sales Staff       | HQ001               | Sales at HQ            |
| mike.inventory   | inventory123  | Inventory Manager | HQ001, DT001        | Multi-branch inventory |
| lisa.cashier     | cashier123    | Cashier           | HQ001               | Cashier at HQ          |
| david.accountant | accountant123 | Accountant        | HQ001, DT001, NB001 | Multi-branch finance   |
| emma.hr          | hr123         | HR Manager        | HQ001, DT001        | Multi-branch HR        |
| james.sales      | sales123      | Sales Staff       | DT001               | Sales at Downtown      |
| sophia.cashier   | cashier123    | Cashier           | DT001               | Cashier at Downtown    |

## 🔄 Reset Demo Users

If you need to recreate the demo users:

```bash
cd backend

# Delete existing demo users (optional)
poetry run python -c "
from app.db.session import SessionLocal
from app.auth.models import User

db = SessionLocal()
demo_usernames = ['john.manager', 'sarah.sales', 'mike.inventory', 'lisa.cashier',
                  'david.accountant', 'emma.hr', 'james.sales', 'sophia.cashier']
for username in demo_usernames:
    user = db.query(User).filter(User.username == username).first()
    if user:
        db.delete(user)
db.commit()
db.close()
print('Demo users deleted')
"

# Recreate demo users
poetry run python scripts/create_demo_users.py
```

## 🎉 Summary

The demo users showcase:

- ✅ Complete RBAC system
- ✅ Multi-branch access control
- ✅ Different user roles and permissions
- ✅ Real-world ERP scenarios
- ✅ Professional user management
- ✅ Secure authentication
- ✅ Role-based UI access

**All demo users are ready to use! Login and explore the system!** 🚀

---

**Access the application at: http://localhost:3000**
