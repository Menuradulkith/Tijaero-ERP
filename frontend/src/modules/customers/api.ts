import apiClient from "@/api/client";
import { Customer, CustomerCreate, CustomerUpdate } from "./types";

// Helper to clean empty strings to null for optional fields
const cleanCustomerData = (data: CustomerCreate | CustomerUpdate) => {
  return {
    ...data,
    email: data.email?.trim() || null,
    home_contact_number: data.home_contact_number?.trim() || null,
    company_name: data.company_name?.trim() || null,
    occupation: data.occupation?.trim() || null,
    birthdate: data.birthdate?.trim() || null,
    id_card_number: data.id_card_number?.trim() || null,
    passport_no: data.passport_no?.trim() || null,
    payment_address: data.payment_address?.trim() || null,
    delivery_address: data.delivery_address?.trim() || null,
    bank_details: data.bank_details?.trim() || null,
    name_in_cheque_card: data.name_in_cheque_card?.trim() || null,
  };
};

export const customersApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/", {
      params: { skip, limit },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/search", {
      params: { q: query, skip, limit },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Customer>(`/customers/${id}`);
    return response.data;
  },

  create: async (data: CustomerCreate) => {
    const cleanData = cleanCustomerData(data);
    const response = await apiClient.post<Customer>("/customers/", cleanData);
    return response.data;
  },

  update: async (id: number, data: CustomerUpdate) => {
    const cleanData = cleanCustomerData(data);
    const response = await apiClient.put<Customer>(`/customers/${id}`, cleanData);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/${id}`);
  },
};
