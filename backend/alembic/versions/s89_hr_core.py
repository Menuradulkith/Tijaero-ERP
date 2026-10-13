"""HR core: employee master fields, departments, designations, employment types,
shifts, holiday lists, leave types and allocations, employee sub-records.

Revision ID: s89_hr_core
Revises: s88_customer_unique_ci
Create Date: 2026-10-09

The employee record was only (user, employee id). This adds the fields a
standard HR master carries, the organisation / time / leave masters around it,
and the employee sub-records (emergency contacts, dependents, education, work
experience, documents, onboarding and offboarding tasks). Defaults are Sri Lankan
(statutory leave entitlements, EPF/ETF, Sinhala/Tamil New Year...).
"""
from alembic import op
import sqlalchemy as sa

revision = "s89_hr_core"
down_revision = "s88_customer_unique_ci"
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column("created_by", sa.Integer, nullable=True),
        sa.Column("updated_by", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    ]


NEW_PERMISSIONS = [
    # (resource, action, description, granted_like_resource_action)
    ("hr_setup", "view", "View HR setup (departments, designations, shifts, holidays, leave types)", ("employees", "view")),
    ("hr_setup", "create", "Create HR setup records", ("employees", "update")),
    ("hr_setup", "update", "Update HR setup records", ("employees", "update")),
    ("hr_reports", "view", "View HR reports", ("employees", "view")),
    ("leave_allocations", "view", "View leave balances and allocations", ("leaves", "view")),
    ("leave_allocations", "create", "Allocate leave", ("employees", "update")),
    ("leave_allocations", "update", "Adjust leave allocations", ("employees", "update")),
    ("employee_sensitive", "view", "View employee bank, statutory and ID details", ("salary_profiles", "view")),
    ("employee_sensitive", "update", "Update employee bank, statutory and ID details", ("salary_profiles", "update")),
]


def upgrade() -> None:
    # ── organisation ──
    op.create_table(
        "hr_departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("hr_departments.id"), nullable=True),
        sa.Column("head_employee_id", sa.Integer, sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_departments_id", "hr_departments", ["id"])
    op.execute("create unique index uq_hr_departments_code_ci on hr_departments (lower(btrim(code)))")
    op.execute("create unique index uq_hr_departments_name_ci on hr_departments (lower(btrim(name)))")

    op.create_table(
        "hr_designations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("hr_departments.id"), nullable=True),
        sa.Column("grade", sa.String(30), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_designations_id", "hr_designations", ["id"])
    op.execute("create unique index uq_hr_designations_name_ci on hr_designations (lower(btrim(name)))")

    op.create_table(
        "hr_employment_types",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("default_probation_months", sa.Integer, nullable=False, server_default="0"),
        sa.Column("has_end_date", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("epf_etf_applicable", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_employment_types_id", "hr_employment_types", ["id"])
    op.execute("create unique index uq_hr_employment_types_name_ci on hr_employment_types (lower(btrim(name)))")

    # ── time ──
    op.create_table(
        "hr_shifts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("start_time", sa.Time, nullable=False),
        sa.Column("end_time", sa.Time, nullable=False),
        sa.Column("grace_minutes", sa.Integer, nullable=False, server_default="10"),
        sa.Column("break_minutes", sa.Integer, nullable=False, server_default="60"),
        sa.Column("work_minutes", sa.Integer, nullable=False, server_default="480"),
        sa.Column("half_day_minutes", sa.Integer, nullable=False, server_default="240"),
        sa.Column("weekly_off_days", sa.String(20), nullable=False, server_default="6"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_shifts_id", "hr_shifts", ["id"])
    op.execute("create unique index uq_hr_shifts_name_ci on hr_shifts (lower(btrim(name)))")
    op.execute("create unique index uq_hr_shifts_one_default on hr_shifts (is_default) where is_default")

    op.create_table(
        "hr_holiday_lists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_holiday_lists_id", "hr_holiday_lists", ["id"])
    op.execute("create unique index uq_hr_holiday_lists_name_ci on hr_holiday_lists (lower(btrim(name)))")
    op.execute("create unique index uq_hr_holiday_lists_default_year on hr_holiday_lists (year) where is_default")

    op.create_table(
        "hr_holidays",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("holiday_list_id", sa.Integer, sa.ForeignKey("hr_holiday_lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("holiday_date", sa.Date, nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("holiday_type", sa.String(20), nullable=False, server_default="public"),
        sa.UniqueConstraint("holiday_list_id", "holiday_date", name="uq_hr_holiday_list_date"),
        *_audit(),
    )
    op.create_index("ix_hr_holidays_holiday_list_id", "hr_holidays", ["holiday_list_id"])

    # ── leave ──
    op.create_table(
        "hr_leave_types",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("annual_entitlement", sa.Float, nullable=False, server_default="0"),
        sa.Column("accrual", sa.String(10), nullable=False, server_default="none"),
        sa.Column("carry_forward_max", sa.Float, nullable=False, server_default="0"),
        sa.Column("is_paid", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("allow_half_day", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("allow_negative_balance", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("max_consecutive_days", sa.Float, nullable=True),
        sa.Column("min_service_months", sa.Integer, nullable=False, server_default="0"),
        sa.Column("applicable_gender", sa.String(10), nullable=False, server_default="all"),
        sa.Column("document_required_after_days", sa.Float, nullable=True),
        sa.Column("count_holidays", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_hr_leave_types_id", "hr_leave_types", ["id"])
    op.execute("create unique index uq_hr_leave_types_code_ci on hr_leave_types (lower(btrim(code)))")
    op.execute("create unique index uq_hr_leave_types_name_ci on hr_leave_types (lower(btrim(name)))")

    op.create_table(
        "hr_leave_allocations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("employee_pk", sa.Integer, sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("leave_type_id", sa.Integer, sa.ForeignKey("hr_leave_types.id"), nullable=False),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("allocated", sa.Float, nullable=False, server_default="0"),
        sa.Column("carried_forward", sa.Float, nullable=False, server_default="0"),
        sa.Column("adjustment", sa.Float, nullable=False, server_default="0"),
        sa.Column("remarks", sa.Text, nullable=True),
        sa.UniqueConstraint("employee_pk", "leave_type_id", "year", name="uq_hr_leave_alloc"),
        *_audit(),
    )
    op.create_index("ix_hr_leave_allocations_employee_pk", "hr_leave_allocations", ["employee_pk"])
    op.create_index("ix_hr_leave_allocations_year", "hr_leave_allocations", ["year"])

    # ── employee master columns ──
    emp_cols = [
        ("name_with_initials", sa.String(200)), ("nic", sa.String(20)), ("passport_no", sa.String(30)),
        ("marital_status", sa.String(15)), ("nationality", sa.String(60)), ("religion", sa.String(60)), ("blood_group", sa.String(5)),
        ("personal_email", sa.String(255)), ("mobile_phone", sa.String(30)), ("home_phone", sa.String(30)),
        ("address_line1", sa.String(200)), ("address_line2", sa.String(200)), ("city", sa.String(100)), ("district", sa.String(100)),
        ("postal_code", sa.String(20)), ("permanent_address", sa.Text),
        ("branch_code", sa.String(20)), ("grade", sa.String(30)), ("work_location", sa.String(150)),
        ("date_of_joining", sa.Date), ("probation_end_date", sa.Date), ("confirmation_date", sa.Date), ("contract_end_date", sa.Date),
        ("notice_period_days", sa.Integer), ("retirement_date", sa.Date),
        ("resignation_date", sa.Date), ("last_working_date", sa.Date), ("exit_type", sa.String(20)), ("exit_reason", sa.Text),
        ("bank_name", sa.String(100)), ("bank_branch", sa.String(100)), ("bank_account_no", sa.String(40)), ("bank_account_name", sa.String(150)),
        ("epf_no", sa.String(30)), ("etf_no", sa.String(30)), ("tin_no", sa.String(30)),
    ]
    for name, typ in emp_cols:
        op.add_column("employees", sa.Column(name, typ, nullable=True))
    op.add_column("employees", sa.Column("status", sa.String(20), nullable=False, server_default="active"))
    op.add_column("employees", sa.Column("department_id", sa.Integer, sa.ForeignKey("hr_departments.id"), nullable=True))
    op.add_column("employees", sa.Column("designation_id", sa.Integer, sa.ForeignKey("hr_designations.id"), nullable=True))
    op.add_column("employees", sa.Column("employment_type_id", sa.Integer, sa.ForeignKey("hr_employment_types.id"), nullable=True))
    op.add_column("employees", sa.Column("reports_to_id", sa.Integer, sa.ForeignKey("employees.id"), nullable=True))
    op.add_column("employees", sa.Column("shift_id", sa.Integer, sa.ForeignKey("hr_shifts.id"), nullable=True))
    op.add_column("employees", sa.Column("holiday_list_id", sa.Integer, sa.ForeignKey("hr_holiday_lists.id"), nullable=True))
    op.create_index("ix_employees_status", "employees", ["status"])
    op.create_index("ix_employees_department_id", "employees", ["department_id"])
    op.create_index("ix_employees_branch_code", "employees", ["branch_code"])
    for name, col in (("uq_employees_nic_ci", "nic"), ("uq_employees_passport_ci", "passport_no"), ("uq_employees_epf_ci", "epf_no"), ("uq_employees_etf_ci", "etf_no")):
        op.execute(f"create unique index {name} on employees (lower(btrim({col}))) where {col} is not null and btrim({col}) <> ''")

    # ── sub-records ──
    def child(name, *cols):
        op.create_table(
            name, sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("employee_pk", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
            *cols, *_audit(),
        )
        op.create_index(f"ix_{name}_employee_pk", name, ["employee_pk"])

    child("hr_emergency_contacts",
          sa.Column("name", sa.String(150), nullable=False), sa.Column("relationship_type", sa.String(50), nullable=False),
          sa.Column("phone", sa.String(30), nullable=False), sa.Column("alt_phone", sa.String(30)), sa.Column("address", sa.Text),
          sa.Column("is_primary", sa.Boolean, nullable=False, server_default=sa.false()))
    child("hr_dependents",
          sa.Column("name", sa.String(150), nullable=False), sa.Column("relationship_type", sa.String(50), nullable=False),
          sa.Column("date_of_birth", sa.Date), sa.Column("nic", sa.String(20)), sa.Column("gender", sa.String(10)),
          sa.Column("is_beneficiary", sa.Boolean, nullable=False, server_default=sa.false()), sa.Column("remarks", sa.Text))
    child("hr_education",
          sa.Column("level", sa.String(30), nullable=False), sa.Column("qualification", sa.String(200), nullable=False),
          sa.Column("institution", sa.String(200), nullable=False), sa.Column("field_of_study", sa.String(200)),
          sa.Column("start_year", sa.Integer), sa.Column("end_year", sa.Integer), sa.Column("grade", sa.String(50)))
    child("hr_experience",
          sa.Column("company", sa.String(200), nullable=False), sa.Column("designation", sa.String(150), nullable=False),
          sa.Column("from_date", sa.Date, nullable=False), sa.Column("to_date", sa.Date), sa.Column("last_salary", sa.Numeric(18, 2)),
          sa.Column("reason_for_leaving", sa.Text), sa.Column("reference_name", sa.String(150)), sa.Column("reference_contact", sa.String(50)))
    child("hr_documents",
          sa.Column("doc_type", sa.String(30), nullable=False), sa.Column("title", sa.String(200), nullable=False),
          sa.Column("doc_number", sa.String(100)), sa.Column("issue_date", sa.Date), sa.Column("expiry_date", sa.Date),
          sa.Column("file_path", sa.Text), sa.Column("file_name", sa.String(255)), sa.Column("remarks", sa.Text))
    op.create_index("ix_hr_documents_expiry_date", "hr_documents", ["expiry_date"])
    child("hr_onboarding_tasks",
          sa.Column("category", sa.String(15), nullable=False), sa.Column("title", sa.String(200), nullable=False),
          sa.Column("description", sa.Text), sa.Column("responsible", sa.String(100)), sa.Column("due_date", sa.Date),
          sa.Column("status", sa.String(15), nullable=False, server_default="pending"), sa.Column("completed_date", sa.Date),
          sa.Column("completed_by", sa.Integer), sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"))

    # ── defaults ──
    conn = op.get_bind()
    conn.execute(sa.text("""
        insert into hr_employment_types (name, description, default_probation_months, has_end_date, epf_etf_applicable) values
        ('Permanent', 'Confirmed full-time employee', 6, false, true),
        ('Probation', 'New employee on probation', 6, false, true),
        ('Contract', 'Fixed-term contract', 0, true, true),
        ('Part-time', 'Part-time employee', 0, false, true),
        ('Casual', 'Casual / daily paid', 0, true, false),
        ('Intern', 'Intern / trainee', 0, true, false)
    """))
    conn.execute(sa.text("""
        insert into hr_leave_types (code, name, description, annual_entitlement, accrual, carry_forward_max, is_paid, allow_half_day,
                                    allow_negative_balance, max_consecutive_days, min_service_months, applicable_gender,
                                    document_required_after_days, count_holidays) values
        ('annual',  'Annual Leave',  'Sri Lanka Shop & Office Act: 14 days after the first year of service', 14, 'none', 7, true, true, false, null, 0, 'all', null, false),
        ('casual',  'Casual Leave',  '7 days a year', 7, 'none', 0, true, true, false, 3, 0, 'all', null, false),
        ('medical', 'Medical (Sick) Leave', '7 days a year; a medical certificate is needed for more than 2 consecutive days', 7, 'none', 0, true, true, false, null, 0, 'all', 2, false),
        ('maternity', 'Maternity Leave', '84 working days for the first two live births', 84, 'none', 0, true, false, false, 84, 0, 'female', null, false),
        ('unpaid',  'No-pay Leave',  'Leave without pay', 0, 'none', 0, false, true, true, null, 0, 'all', null, false),
        ('other',   'Other Leave',   'Special / other approved leave', 0, 'none', 0, true, true, true, null, 0, 'all', null, false)
    """))
    conn.execute(sa.text("""
        insert into hr_shifts (name, start_time, end_time, grace_minutes, break_minutes, work_minutes, half_day_minutes, weekly_off_days, is_default)
        values ('General (9:00 - 17:00)', '09:00', '17:00', 10, 60, 480, 240, '6', true)
    """))
    conn.execute(sa.text("insert into hr_holiday_lists (name, year, is_default) values ('Sri Lanka 2026 (fixed-date holidays)', 2026, true)"))
    conn.execute(sa.text("""
        insert into hr_holidays (holiday_list_id, holiday_date, name, holiday_type)
        select l.id, d.dt::date, d.nm, d.tp from hr_holiday_lists l,
          (values ('2026-02-04', 'Independence Day', 'public'), ('2026-04-13', 'Day before Sinhala & Tamil New Year', 'public'),
                  ('2026-04-14', 'Sinhala & Tamil New Year', 'public'), ('2026-05-01', 'May Day', 'public'),
                  ('2026-12-25', 'Christmas Day', 'public')) as d(dt, nm, tp)
        where l.name like 'Sri Lanka 2026%'
    """))
    # employees that already exist: joining date from the user account, default shift and holiday list
    conn.execute(sa.text("""
        update employees e set date_of_joining = u.date_joined
        from accounts_user u where u.id = e.user_id and e.date_of_joining is null
    """))
    conn.execute(sa.text("""
        update employees set shift_id = (select id from hr_shifts where is_default limit 1),
                             holiday_list_id = (select id from hr_holiday_lists where is_default limit 1)
    """))

    # ── permissions ──
    for resource, action, desc, like in NEW_PERMISSIONS:
        conn.execute(sa.text(
            "insert into auth_permission (name, resource, action, description, created_at, updated_at) "
            "select cast(:n as varchar), cast(:r as varchar), cast(:a as varchar), cast(:d as varchar), now(), now() where not exists (select 1 from auth_permission where resource=:r and action=:a)"
        ), {"n": f"{action}_{resource}", "r": resource, "a": action, "d": desc})
        # every group that holds the 'like' permission (and Admin) receives the new one
        conn.execute(sa.text("""
            insert into auth_group_permissions (group_id, permission_id)
            select distinct gp.group_id, np.id
            from auth_group_permissions gp
            join auth_permission lp on lp.id = gp.permission_id and lp.resource = :lr and lp.action = :la
            join auth_permission np on np.resource = :r and np.action = :a
            where not exists (select 1 from auth_group_permissions x where x.group_id = gp.group_id and x.permission_id = np.id)
        """), {"lr": like[0], "la": like[1], "r": resource, "a": action})
        conn.execute(sa.text("""
            insert into auth_group_permissions (group_id, permission_id)
            select g.id, np.id from auth_group g join auth_permission np on np.resource = :r and np.action = :a
            where g.name = 'Admin' and not exists (select 1 from auth_group_permissions x where x.group_id = g.id and x.permission_id = np.id)
        """), {"r": resource, "a": action})


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("delete from auth_group_permissions where permission_id in (select id from auth_permission where resource in ('hr_setup','hr_reports','leave_allocations','employee_sensitive'))"))
    conn.execute(sa.text("delete from auth_permission where resource in ('hr_setup','hr_reports','leave_allocations','employee_sensitive')"))
    for t in ("hr_onboarding_tasks", "hr_documents", "hr_experience", "hr_education", "hr_dependents", "hr_emergency_contacts"):
        op.drop_table(t)
    for name in ("uq_employees_nic_ci", "uq_employees_passport_ci", "uq_employees_epf_ci", "uq_employees_etf_ci"):
        op.execute(f"drop index if exists {name}")
    for col in ("holiday_list_id", "shift_id", "reports_to_id", "employment_type_id", "designation_id", "department_id", "status",
                "tin_no", "etf_no", "epf_no", "bank_account_name", "bank_account_no", "bank_branch", "bank_name", "exit_reason", "exit_type",
                "last_working_date", "resignation_date", "retirement_date", "notice_period_days", "contract_end_date", "confirmation_date",
                "probation_end_date", "date_of_joining", "work_location", "grade", "branch_code", "permanent_address", "postal_code",
                "district", "city", "address_line2", "address_line1", "home_phone", "mobile_phone", "personal_email", "blood_group",
                "religion", "nationality", "marital_status", "passport_no", "nic", "name_with_initials"):
        op.drop_column("employees", col)
    for t in ("hr_leave_allocations", "hr_leave_types", "hr_holidays", "hr_holiday_lists", "hr_shifts", "hr_employment_types", "hr_designations", "hr_departments"):
        op.drop_table(t)
