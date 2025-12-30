# Quick Start Guide - Customers, Inventory & Sales Modules

## 🚀 Getting Started

### 1. Start the Backend

```bash
cd backend

# Seed sample data (optional but recommended)
poetry run python scripts/seed_sample_data.py

# Start the server
poetry run uvicorn app.main:app --reload
```

The backend will be available at `http://localhost:8000`

### 2. Start the Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`

### 3. Login

Use your existing credentials:

- Username: `admin`
- Password: Your admin password

---

## 📋 Module Overview

### Customers Module (`/customers`)

**What you can do:**

- ✅ View all customers
- ✅ Search customers by name, email, or phone
- ✅ Add new customers
- ✅ Edit customer information
- ✅ Delete customers
- ✅ Set customer type (Individual/Business)

**Sample Data Included:**

- John Smith (Tech Corp)
- Sarah Johnson (Johnson Enterprises)
- Michael Brown (Brown & Associates)

---

### Inventory Module (`/inventory`)

**What you can do:**

**Products Tab:**

- ✅ View all products
- ✅ Search products by name, code, or model
- ✅ Add new products
- ✅ Edit product details
- ✅ Delete products
- ✅ Set active/inactive status
- ✅ Enable/disable website visibility

**Categories Tab:**

- ✅ View all categories
- ✅ Add new categories
- ✅ Organize products by category

**Brands Tab:**

- ✅ View all brands
- ✅ Add new brands
- ✅ Associate products with brands

**Sample Data Included:**

- Categories: Electronics, Furniture, Stationery
- Brands: Samsung, Apple, IKEA
- Products: Samsung Galaxy S23, iPhone 15 Pro, Office Desk, Office Chair

---

### Sales Module (`/sales`)

**What you can do:**

- ✅ View all sales orders
- ✅ Search orders by invoice number
- ✅ Create new sales orders
- ✅ Add multiple items to an order
- ✅ Select payment method
- ✅ View order totals
- ✅ Delete orders

**Payment Methods Supported:**

- Cash
- Visa Card
- Mastercard
- Amex Card
- Cheque
- Bank Transfer
- Credit

---

## 🎯 Quick Test Workflow

### Test 1: Create a Customer

1. Go to `/customers`
2. Click "Add Customer"
3. Fill in the form:
   - Name: Test Customer
   - Email: test@example.com
   - Phone: 1234567890
   - Type: Individual
4. Click "Create"
5. ✅ Customer appears in the list

### Test 2: Create a Product

1. Go to `/inventory`
2. Make sure you're on the "Products" tab
3. Click "Add Product"
4. Fill in the form:
   - Name: Test Product
   - Item Code: TEST-001
   - Type: product
   - Cost Price: 100
   - Category: Select from dropdown
   - Brand: Select from dropdown
5. Click "Create"
6. ✅ Product appears in the list

### Test 3: Create a Sales Order

1. Go to `/sales`
2. Click "Create Sales Order"
3. Fill in the form:
   - Invoice Number: INV-001
   - Branch Code: MAIN
   - Customer: Select from dropdown
   - Payment Method: Cash
4. Click "Add Item"
5. Select product, enter quantity and price
6. Click "Create Order"
7. ✅ Order appears in the list

---

## 🔐 Permissions

Make sure your user has these permissions:

**For Customers:**

- `customers:view`
- `customers:create`
- `customers:update`
- `customers:delete`

**For Inventory:**

- `inventory:view`
- `inventory:create`
- `inventory:update`
- `inventory:delete`

**For Sales:**

- `sales:view`
- `sales:create`
- `sales:update`
- `sales:delete`

**Tip:** Superusers have all permissions automatically!

---

## 📊 API Documentation

Visit `http://localhost:8000/docs` to see all available API endpoints and test them interactively.

**Key Endpoints:**

**Customers:**

- `GET /api/v1/customers/` - List all customers
- `POST /api/v1/customers/` - Create customer
- `GET /api/v1/customers/{id}` - Get customer details
- `PUT /api/v1/customers/{id}` - Update customer
- `DELETE /api/v1/customers/{id}` - Delete customer

**Inventory:**

- `GET /api/v1/inventory/products/` - List all products
- `POST /api/v1/inventory/products/` - Create product
- `GET /api/v1/inventory/categories/` - List categories
- `GET /api/v1/inventory/brands/` - List brands

**Sales:**

- `GET /api/v1/sales/` - List all sales orders
- `POST /api/v1/sales/` - Create sales order
- `GET /api/v1/sales/{id}` - Get order details
- `DELETE /api/v1/sales/{id}` - Delete order

---

## 🐛 Troubleshooting

### "No customers/products found"

- Run the seed script: `poetry run python scripts/seed_sample_data.py`
- Or create items manually through the UI

### "Permission denied"

- Check your user has the required permissions
- Try logging in as superuser
- Go to `/roles` to assign permissions to your group

### "Cannot connect to backend"

- Make sure backend is running on port 8000
- Check `.env` file in frontend folder
- Verify `VITE_API_URL=http://localhost:8000/api/v1`

### "Module not found" errors

- Run `npm install` in frontend folder
- Run `poetry install` in backend folder

---

## 💡 Tips

1. **Use Search**: All modules have search functionality - use it to quickly find items
2. **Sample Data**: The seed script creates realistic sample data for testing
3. **Permissions**: Test with different user roles to see permission-based UI
4. **API Docs**: Use Swagger UI to test backend APIs directly
5. **Browser Console**: Check for errors if something doesn't work

---

## 🎉 What's Next?

Now that you have the core modules working, you can:

1. **Customize**: Modify fields and validations to match your needs
2. **Extend**: Add more features like:
   - Customer credit tracking
   - Stock level management
   - Invoice printing
   - Sales analytics
3. **Integrate**: Connect with other modules (Finance, HR, etc.)
4. **Deploy**: Prepare for production deployment

---

## 📚 Additional Resources

- **Full Documentation**: See `MODULES_IMPLEMENTATION.md`
- **Permission System**: See `PERMISSION_SYSTEM_SUMMARY.md`
- **API Reference**: `http://localhost:8000/docs`
- **Frontend README**: `frontend/README.md`
- **Backend README**: `backend/README.md`

---

## ✅ Success Checklist

- [ ] Backend running on port 8000
- [ ] Frontend running on port 5173
- [ ] Sample data seeded
- [ ] Can login successfully
- [ ] Can view customers list
- [ ] Can create a new customer
- [ ] Can view products list
- [ ] Can create a new product
- [ ] Can view sales orders
- [ ] Can create a sales order
- [ ] All permissions working correctly

If all items are checked, you're ready to go! 🚀
