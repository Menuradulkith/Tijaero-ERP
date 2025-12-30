from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime, date

class CustomerBase(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255, description="Customer name")
    title: str = Field(..., max_length=30, description="Title (Mr/Ms/Mrs)")
    email: Optional[str] = Field(None, max_length=75, description="Customer email address")
    mobile_contact_number: str = Field(..., max_length=12, description="Mobile contact number")
    home_contact_number: Optional[str] = Field(None, max_length=12, description="Home contact number")
    company_name: Optional[str] = Field(None, max_length=255, description="Company name")
    occupation: Optional[str] = Field(None, max_length=255, description="Occupation")
    gender: str = Field(..., max_length=30, description="Gender")
    civil_status: str = Field(..., max_length=30, description="Civil status")
    no_of_kids: str = Field(..., max_length=30, description="Number of kids")
    birthdate: Optional[date] = Field(None, description="Birth date")
    id_card_number: Optional[str] = Field(None, max_length=12, description="ID card number")
    passport_no: Optional[str] = Field(None, max_length=50, description="Passport number")
    payment_address: Optional[str] = Field(None, description="Payment address")
    delivery_address: Optional[str] = Field(None, description="Delivery address")
    bank_details: Optional[str] = Field(None, description="Bank details")
    name_in_cheque_card: Optional[str] = Field(None, max_length=255, description="Name in cheque/card")
    credit_days: int = Field(default=0, description="Credit days")
    max_credit_limit: int = Field(default=0, description="Maximum credit limit")
    left_credit_amount: Optional[int] = Field(None, description="Left credit amount")
    initial_credit_amount: Optional[int] = Field(None, description="Initial credit amount")
    active: bool = Field(default=True, description="Is active")
    is_customer_agent: bool = Field(default=False, description="Is customer agent")
    country_id: Optional[int] = Field(None, description="Country ID")

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(BaseModel):
    customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    title: Optional[str] = Field(None, max_length=30)
    email: Optional[str] = Field(None, max_length=75)
    mobile_contact_number: Optional[str] = Field(None, max_length=12)
    home_contact_number: Optional[str] = Field(None, max_length=12)
    company_name: Optional[str] = Field(None, max_length=255)
    occupation: Optional[str] = Field(None, max_length=255)
    gender: Optional[str] = Field(None, max_length=30)
    civil_status: Optional[str] = Field(None, max_length=30)
    no_of_kids: Optional[str] = Field(None, max_length=30)
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = Field(None, max_length=12)
    passport_no: Optional[str] = Field(None, max_length=50)
    payment_address: Optional[str] = None
    delivery_address: Optional[str] = None
    bank_details: Optional[str] = None
    name_in_cheque_card: Optional[str] = Field(None, max_length=255)
    credit_days: Optional[int] = None
    max_credit_limit: Optional[int] = None
    left_credit_amount: Optional[int] = None
    initial_credit_amount: Optional[int] = None
    active: Optional[bool] = None
    is_customer_agent: Optional[bool] = None
    country_id: Optional[int] = None

class Customer(CustomerBase):
    id: int
    date_joined: datetime
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    
    class Config:
        from_attributes = True

class CustomerList(BaseModel):
    total: int
    items: list[Customer]
    
    class Config:
        from_attributes = True
