-- Throwaway load-test volume: ~5 years of trading for a 10-branch retailer.
SET session_replication_role = replica;
TRUNCATE category, items_brand, products, customers, invoices, invoice_items, general_ledger RESTART IDENTITY CASCADE;
INSERT INTO category(name, category_code, active) SELECT 'Cat '||g, 'C'||g, true FROM generate_series(1,50) g;
INSERT INTO items_brand(brand_name,brand_code) SELECT 'Brand '||g,'B'||lpad(g::text,3,'0') FROM generate_series(1,100) g;
INSERT INTO products(item_type,item_code,name,cost_price,selling_price,active,website_active,created_date,category_id,items_brand_id)
 SELECT 'serial','ITM'||lpad(g::text,6,'0'),'Product '||g,(50+random()*500)::numeric(12,2),(100+random()*900)::numeric(12,2),true,false,current_date-(random()*1800)::int,
 (SELECT min(id) FROM category)+(g%50),(SELECT min(id) FROM items_brand)+(g%100) FROM generate_series(1,20000) g;
INSERT INTO customers(customer_no,customer_name,credit_days,max_credit_limit,active,is_customer_agent,mobile_contact_number)
 SELECT lpad(g::text,6,'0'),'Customer '||g,30,100000,true,false,'07'||lpad((random()*99999999)::int::text,8,'0') FROM generate_series(1,10000) g;
-- 300k invoices
INSERT INTO invoices(invoice_no,approval_status,payment_method,payment_status,created_date,created_date_time,customer_id,branch_code,approval,bank_transfer_amount,card_amex_amount,card_mastercard_amount,card_visa_amount,cash_amount,cheque_date,cheque_amount,payment_adjustments,credit_amount,cupon_amount,special,status,tax_rate,tax_amount,discount_percent,discount_amount,subtotal,grand_total,paid_amount,balance_due,service_charge_rate,service_charge_amount,gift_voucher_amount,credit_note_amount,created_by)
 SELECT 'INV'||lpad(g::text,7,'0'),'approved','cash','paid',d::date, d, (SELECT min(id) FROM customers)+(g%10000), (ARRAY['BR-ANR01','BR-BTC01','BR-CMB01'])[1+g%3], true,0,0,0,0,t,current_date,0,0,0,0,false,true,0,0,0,0,t,t,t,0,0,0,0,0,1
 FROM (SELECT g, (current_date - (random()*1800)::int) + (random()*86400||' seconds')::interval AS d, (100+random()*20000)::numeric(12,2) AS t FROM generate_series(1,300000) g) s;
-- 3 lines per invoice
INSERT INTO invoice_items(warrenty_month,invoice_id,product_id,quantity,selling_price,minimum_selling_price,tax_rate,tax_amount,discount_percent,discount_amount,line_total)
 SELECT '0',i.id,(SELECT min(id) FROM products)+((i.id*k)%20000),1+(i.id%5),500,400,0,0,0,0,500*(1+(i.id%5))
 FROM invoices i, generate_series(1,3) k;
-- GL: 1M rows
INSERT INTO general_ledger(transaction_type,transaction_date,posting_date,account_id,fiscal_year,fiscal_period)
 SELECT 'sale',d,d,1,extract(year from d)::int,extract(month from d)::int FROM (SELECT current_date-(random()*1800)::int d FROM generate_series(1,1000000)) s;
ANALYZE;
