# 🚀 Start Both Servers

Quick guide to start your ERP system.

## 📋 Prerequisites

- Python 3.8+ installed
- Node.js 18+ installed
- Dependencies installed (see below if not)

## 🔧 First Time Setup

### Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
# or if using poetry:
poetry install
```

### Frontend Dependencies

```bash
cd frontend
npm install
```

## 🚀 Starting the Servers

### Terminal 1: Backend Server

```bash
cd backend
./start.sh
```

Or manually:

```bash
cd backend
uvicorn app.main:app --reload
```

**Expected output:**

```
🚀 Starting ERP Backend Server...
✅ CORS configuration is correct!
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

**Backend URLs:**

- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Terminal 2: Frontend Server

Open a **new terminal** window:

```bash
cd frontend
npm run dev
```

**Expected output:**

```
  VITE v5.0.11  ready in 500 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  press h to show help
```

**Frontend URL:**

- App: http://localhost:3000

## 🎯 Access the Application

1. **Open browser:** http://localhost:3000

2. **Login with your credentials:**

   - Username: `admin` (or your username)
   - Password: Your backend password

3. **You should see the dashboard!** 🎉

## ✅ Verify Everything is Working

### Check 1: Backend Health

```bash
curl http://localhost:8000
```

Should return: `{"message": "ERP API", "version": "1.0.0"}`

### Check 2: Frontend Loading

Open http://localhost:3000 - should see login page

### Check 3: CORS Working

Try to login - should NOT see CORS errors in browser console

## 🛑 Stopping the Servers

### Stop Backend

In the backend terminal, press: `Ctrl+C`

### Stop Frontend

In the frontend terminal, press: `Ctrl+C`

## 🐛 Troubleshooting

### Backend won't start

**Error: "Address already in use"**

```bash
# Find what's using port 8000
lsof -i :8000

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or use a different port
uvicorn app.main:app --reload --port 8001
```

**Error: "Module not found"**

```bash
cd backend
pip install -r requirements.txt
```

### Frontend won't start

**Error: "Port 3000 already in use"**

```bash
# Kill the process using port 3000
lsof -i :3000
kill -9 <PID>

# Or the frontend will offer to use a different port
```

**Error: "Cannot find module"**

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### CORS Errors

**Error: "No 'Access-Control-Allow-Origin' header"**

1. Stop backend (Ctrl+C)
2. Restart backend:
   ```bash
   cd backend
   ./start.sh
   ```
3. Clear browser cache (Ctrl+Shift+R)
4. Try again

See `CORS_FIX.md` for detailed CORS troubleshooting.

## 📊 Port Summary

| Service  | Port | URL                        |
| -------- | ---- | -------------------------- |
| Backend  | 8000 | http://localhost:8000      |
| Frontend | 3000 | http://localhost:3000      |
| API Docs | 8000 | http://localhost:8000/docs |

## 🔄 Development Workflow

### Normal Development

1. Start both servers (as shown above)
2. Make changes to code
3. **Backend:** Auto-reloads with `--reload` flag
4. **Frontend:** Auto-reloads with Vite HMR
5. Refresh browser to see changes

### After Pulling New Code

```bash
# Update backend dependencies
cd backend
pip install -r requirements.txt

# Update frontend dependencies
cd frontend
npm install

# Restart both servers
```

### After Changing .env Files

```bash
# Backend: Must restart
cd backend
# Stop with Ctrl+C, then:
./start.sh

# Frontend: Must restart
cd frontend
# Stop with Ctrl+C, then:
npm run dev
```

## 🎨 Quick Commands

### Backend

```bash
cd backend

# Start server
./start.sh

# Run tests
pytest

# Check CORS config
python test_cors.py

# Create database
python scripts/init_db.py

# Create superuser
python scripts/create_superuser.py
```

### Frontend

```bash
cd frontend

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint

# Test connection
open test-connection.html
```

## 📝 Default Credentials

Check your backend setup for credentials. Common defaults:

- Username: `admin`
- Password: `admin123` or `admin`

To create a new superuser:

```bash
cd backend
python scripts/create_superuser.py
```

## 🎉 Success!

When everything is working:

- ✅ Backend running on port 8000
- ✅ Frontend running on port 3000
- ✅ No CORS errors
- ✅ Can login successfully
- ✅ Dashboard loads with data

---

**Happy coding! 🚀**
