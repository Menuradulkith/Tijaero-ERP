# ERP System Pagination & Query Limits Analysis

## Executive Summary

This document identifies all pagination limits and potential data retrieval bottlenecks throughout the TijaeroERP system. These limits could cause issues where newly created records don't appear in lists, similar to the previously identified customer limit of 100.

---

## 🔴 CRITICAL ISSUES - Default Limit of 100 Records

### 1. **Customers Module**
**Location:** `backend/app/modules/customers/api.py`

```python
# Line 23-27
limit: int = Query(100, ge=1, le=100000, description="Maximum number of records to return")
```

**Impact:** 
- Customer list endpoint defaults to 100 records
- Newly created customers beyond 100 won't show in default list
- Affects: `/api/v1/customers/` GET endpoint

**Current Behavior:**
- Default: 100 customers
- Maximum allowed: 100,000
- User must explicitly request more via `limit` parameter

---

### 2. **Products Module**
**Location:** `backend/app/modules/products/api.py`

```python
# Line 16-17
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- Product list defaults to 100 records
- Active product filter might hide new products
- Affects: `/api/v1/products/` GET endpoint

---

### 3. **Suppliers Module**
**Location:** `backend/app/modules/purchasing/api.py`

```python
# Line 290-291
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- Supplier list defaults to 100 records
- Affects: `/api/v1/purchasing/suppliers` GET endpoint

---

### 4. **Categories & Brands**
**Location:** `backend/app/modules/products/api.py`

```python
# Categories - Line 98
limit: int = Query(100, ge=1, le=100000)

# Brands - Line 186
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- Both category and brand lists default to 100 records
- New categories/brands may not appear without explicit limit parameter

---

### 5. **Purchase Orders**
**Location:** `backend/app/modules/purchasing/api.py`

```python
# Line 421
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- Purchase order list defaults to 100 records
- Affects: `/api/v1/purchasing/orders` GET endpoint

---

### 6. **Good Received Notes (GRN)**
**Location:** `backend/app/modules/purchasing/api.py`

```python
# Line 786
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- GRN list defaults to 100 records
- Affects: `/api/v1/purchasing/grn` GET endpoint

---

### 7. **Coupons & Gift Vouchers**
**Location:** `backend/app/modules/customers/api.py`

```python
# Coupons - Line 360-361
limit: int = Query(100, ge=1, le=100000)

# Vouchers - Line 608-609  
limit: int = Query(100, ge=1, le=100000)
```

**Impact:**
- Both coupon and voucher lists default to 100 records
- New promotional items may not appear

---

## 🟡 MEDIUM PRIORITY - Sales Module Limits

### 8. **Sales Invoices**
**Location:** `backend/app/modules/sales/api.py`

```python
# Line 71
page_size: int = Query(50, ge=10, le=100000)
```

**Impact:**
- **Different default: 50 records per page**
- Uses paginated response with page/page_size pattern
- Affects: `/api/v1/sales/invoices` GET endpoint

---

### 9. **Sale Returns**
**Location:** `backend/app/modules/sales/api.py`

```python
# Line 279
page_size: int = Query(50, ge=10, le=100000)
```

**Impact:**
- **Defaults to 50 records per page**
- Uses paginated response
- Affects: `/api/v1/sales/returns` GET endpoint

---

## 🟢 FRONTEND CONFIGURATION

### 10. **Frontend Pagination Settings**
**Location:** `frontend/src/constants/config.ts`

```typescript
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 100,
} as const;
```

**Issues:**
- Frontend defaults to 20 records per page
- Backend defaults to 50-100 records per page
- **MISMATCH:** Frontend max is 100, but backend allows up to 100,000
- Some pages override this (SalesTrackPage uses 100)

---

## 🔵 SPECIAL CASES - Hardcoded Limits

### 11. **Reporting Limits**
**Location:** `backend/app/modules/reporting/service.py`

```python
# Line 85 - Top products limit
.limit(10)

# Line 818 - Top selling products
.limit(5)

# Line 841 - Recent invoices
.limit(3)

# Line 888 - Recent customers
.limit(2)
```

**Impact:**
- Dashboard statistics show limited data
- These are intentional for performance, but users should be aware

---

### 12. **CSV Export Limits**
**Location:** `backend/app/modules/finance/api.py`

```python
# Line 708 - Expenses export
rows = query.limit(100000).all()

# Line 730 - Bank deposits export
rows = query.limit(100000).all()
```

**Impact:**
- CSV exports limited to 100,000 records
- Large datasets may be truncated

---

## 📊 SERVICE LAYER DEFAULTS

### 13. **Customer Service**
**Location:** `backend/app/modules/customers/service.py`

```python
# Line 22
def get_all_customers(self, db: Session, skip: int = 0, limit: int = 100, ...)
```

**Impact:**
- Service layer also defaults to 100
- Cascades to all calling code

---

### 14. **Product Service**
**Location:** `backend/app/modules/products/service.py`

```python
# Line 16
def get_all_products(self, db: Session, skip: int = 0, limit: int = 100, ...)
```

---

## 🔍 REPOSITORY LAYER

### 15. **Base Repository**
**Location:** `backend/app/common/base_repository.py`

```python
def get_all(self, *, session: Session, skip: int = 0, limit: int = 100)
```

**Impact:**
- Base class sets 100 as default
- All repositories inheriting this get the same limit

---

## 🚨 NO PAGINATION - Potential Performance Issues

### 16. **Endpoints WITHOUT Pagination**

**Support Tickets:** `backend/app/modules/support/api.py`
```python
@router.get("/tickets", response_model=List[schemas.CustomerSupport])
# Uses filter with skip/limit but no max enforced
```

**Locations:** `backend/app/modules/common/api.py`
```python
@router.get("/locations", response_model=List[schemas.Location])
# No pagination at all!
```

**Countries:** `backend/app/modules/common/api.py`
```python
@router.get("/countries", response_model=List[schemas.Country])
# No pagination at all!
```

**Impact:**
- These endpoints load ALL records
- Performance degrades with large datasets
- Memory issues possible

---

## 📝 RECOMMENDATIONS

### Immediate Actions:

1. **Increase Default Limits for Main Entities**
   - Customers: 100 → 1000
   - Products: 100 → 1000
   - Suppliers: 100 → 500
   - Orders/GRNs: 100 → 500

2. **Standardize Pagination**
   - Use consistent defaults across backend (currently 50-100)
   - Match frontend max (100) or increase it to 1000
   - Document pagination expectations

3. **Frontend Updates**
   - Increase `MAX_PAGE_SIZE` from 100 to 1000
   - Add "Show All" option with confirmation for large datasets
   - Implement virtual scrolling for large lists

4. **Add Pagination to Reference Data**
   - Locations endpoint needs pagination
   - Countries endpoint needs pagination

5. **User Experience**
   - Add warning when viewing limited results
   - Show "X of Y total records" indicator
   - Add "Load More" or "Show All" buttons

### Long-term Improvements:

1. **Implement Cursor-Based Pagination**
   - Better performance for large datasets
   - Consistent results during concurrent modifications

2. **Add Search/Filter First**
   - Encourage users to search rather than browse all
   - Pre-filter by active status by default

3. **Monitoring & Alerts**
   - Track when users hit pagination limits
   - Alert admins when tables grow beyond thresholds

4. **Configuration**
   - Make default limits configurable via environment variables
   - Allow per-user or per-role limit overrides

---

## 🎯 PRIORITY MATRIX

| Module | Current Limit | Recommended | Priority | Reason |
|--------|---------------|-------------|----------|--------|
| Customers | 100 | 1000 | 🔴 Critical | Core business entity |
| Products | 100 | 1000 | 🔴 Critical | Core business entity |
| Suppliers | 100 | 500 | 🟡 High | Important but fewer records |
| Categories | 100 | 500 | 🟢 Medium | Reference data |
| Brands | 100 | 500 | 🟢 Medium | Reference data |
| Orders | 100 | 500 | 🟡 High | Transaction data |
| GRNs | 100 | 500 | 🟡 High | Transaction data |
| Invoices | 50 | 500 | 🔴 Critical | Core transaction |
| Locations | None | 100 | 🟡 High | Needs pagination |
| Countries | None | 100 | 🟢 Low | Static reference data |

---

## 📌 SUMMARY OF FINDINGS

**Total Issues Found:** 16 categories

**Critical Issues:** 7
- Customers (100 limit)
- Products (100 limit)
- Suppliers (100 limit)
- Categories (100 limit)
- Brands (100 limit)
- Coupons (100 limit)
- Vouchers (100 limit)

**High Priority:** 5
- Sales Invoices (50 limit)
- Sale Returns (50 limit)
- Purchase Orders (100 limit)
- GRNs (100 limit)
- Locations (no pagination)

**Configuration Issues:** 2
- Frontend/Backend mismatch
- Inconsistent defaults (20 vs 50 vs 100)

**Performance Concerns:** 2
- Locations endpoint (no pagination)
- Countries endpoint (no pagination)

---

## 🔧 IMPLEMENTATION NOTES

When implementing fixes:

1. **Backward Compatibility:** Maintain existing `limit` parameter behavior
2. **Performance Testing:** Test with datasets of 10K, 50K, 100K records
3. **Database Indexing:** Ensure proper indexes on commonly filtered columns
4. **Query Optimization:** Review N+1 queries in list endpoints
5. **Caching Strategy:** Consider caching reference data (countries, locations)

---

**Generated:** June 7, 2026
**Analysis Version:** 1.0
**System:** TijaeroERP
