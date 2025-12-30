# 🔐 Login Credentials

## Default Credentials

Based on your backend setup, the default superuser credentials are:

```
Username: admin
Password: admin123
```

## 🚀 Create a Superuser

If the default credentials don't work, create a new superuser:

### Method 1: Using the Script (Easiest)

```bash
cd backend
python scripts/create_superuser.py
```

This creates:

- **Username:** `admin`
- **Password:** `admin123`
- **Email:** `admin@example.com`

### Method 2: Custom Credentials

Create a custom superuser with your own credentials:

```bash
cd backend
python -c "
from app.db.session import SessionLocal
from app.auth.models import User
from app.core.security import get_password_hash
from datetime import date

db = SessionLocal()

# Check if user exists
existing = db.query(User).filter(User.username == 'admin').first()
if existing:
    print('User admin already exists!')
    print('Username: admin')
    print('Try password: admin123')
else:
    # Create new user
    user = User(
        email='admin@example.com',
        username='admin',
        password=get_password_hash('admin123'),
        first_name='Admin',
        last_name='User',
        middle_name='',
        gender='Male',
        is_superuser=True,
        is_staff=True,
        is_active=True,
        verify=True,
        blocked=False,
        date_joined=date.today(),
        birthdate=date(1990, 1, 1),
        employee_id='EMP001',
        occupation='Administrator'
    )
    db.add(user)
    db.commit()
    print('✅ Superuser created successfully!')
    print('Username: admin')
    print('Password: admin123')

db.close()
"
```

### Method 3: Interactive Creation

Create a user interactively:

```bash
cd backend
python
```

Then paste this:

```python
from app.db.session import SessionLocal
from app.auth.models import User
from app.core.security import get_password_hash
from datetime import date

# Get credentials
username = input("Enter username: ")
password = input("Enter password: ")
email = input("Enter email: ")

db = SessionLocal()

user = User(
    email=email,
    username=username,
    password=get_password_hash(password),
    first_name='Admin',
    last_name='User',
    middle_name='',
    gender='Male',
    is_superuser=True,
    is_staff=True,
    is_active=True,
    verify=True,
    blocked=False,
    date_joined=date.today(),
    birthdate=date(1990, 1, 1),
    employee_id='EMP001',
    occupation='Administrator'
)

db.add(user)
db.commit()
print(f"✅ User '{username}' created successfully!")
db.close()
```

## 🔍 Check Existing Users

See what users exist in your database:

```bash
cd backend
python -c "
from app.db.session import SessionLocal
from app.auth.models import User

db = SessionLocal()
users = db.query(User).all()

print('Existing users:')
print('-' * 50)
for user in users:
    print(f'Username: {user.username}')
    print(f'Email: {user.email}')
    print(f'Is Active: {user.is_active}')
    print(f'Is Superuser: {user.is_superuser}')
    print('-' * 50)

db.close()
"
```

## 🔄 Reset Password

If you forgot your password, reset it:

```bash
cd backend
python -c "
from app.db.session import SessionLocal
from app.auth.models import User
from app.core.security import get_password_hash

username = 'admin'
new_password = 'admin123'

db = SessionLocal()
user = db.query(User).filter(User.username == username).first()

if user:
    user.password = get_password_hash(new_password)
    db.commit()
    print(f'✅ Password reset for user: {username}')
    print(f'New password: {new_password}')
else:
    print(f'❌ User {username} not found!')

db.close()
"
```

## 🧪 Test Login

Test if credentials work:

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"
```

**Success response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

**Error response:**

```json
{
  "detail": "Incorrect username or password"
}
```

## 📝 Common Issues

### Issue 1: "Incorrect username or password"

**Solutions:**

1. Check username is exactly `admin` (lowercase)
2. Check password is exactly `admin123`
3. Create a new superuser (see above)
4. Reset password (see above)

### Issue 2: "User not found"

**Solution:**

```bash
cd backend
python scripts/create_superuser.py
```

### Issue 3: Database not initialized

**Solution:**

```bash
cd backend
python scripts/init_db.py
python scripts/create_superuser.py
```

## 🎯 Quick Start

If you're starting fresh:

```bash
# 1. Initialize database
cd backend
python scripts/init_db.py

# 2. Create superuser
python scripts/create_superuser.py

# 3. Start backend
uvicorn app.main:app --reload

# 4. Test login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"
```

## 📋 Summary

| Field    | Value               |
| -------- | ------------------- |
| Username | `admin`             |
| Password | `admin123`          |
| Email    | `admin@example.com` |
| Role     | Superuser           |

---

**Try these credentials on the login page: http://localhost:3000**
