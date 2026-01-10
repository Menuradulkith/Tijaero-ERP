/**
 * Form Related Types
 */

import type { ReactNode } from 'react';
import type { SelectOption } from './common';

// Form field state
export interface FieldState<T = unknown> {
  value: T;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

// Form state
export interface FormState<T extends Record<string, unknown>> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
}

// Form field props (generic)
export interface FormFieldProps<T = unknown> {
  name: string;
  label?: string;
  placeholder?: string;
  value: T;
  onChange: (value: T) => void;
  onBlur?: () => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  helpText?: string;
  className?: string;
}

// Input types
export type InputType = 
  | 'text' 
  | 'email' 
  | 'password' 
  | 'number' 
  | 'tel' 
  | 'url' 
  | 'search'
  | 'date'
  | 'time'
  | 'datetime-local';

// Text input props
export interface TextInputProps extends FormFieldProps<string> {
  type?: InputType;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  autoComplete?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

// Number input props
export interface NumberInputProps extends FormFieldProps<number | null> {
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
}

// Select props
export interface SelectProps<T = string> extends FormFieldProps<T | null> {
  options: SelectOption<T>[];
  isSearchable?: boolean;
  isClearable?: boolean;
  isMulti?: boolean;
  isLoading?: boolean;
}

// Re-export SelectOption for convenience
export type { SelectOption };

// Checkbox props
export interface CheckboxProps extends FormFieldProps<boolean> {
  indeterminate?: boolean;
}

// Radio group props
export interface RadioGroupProps<T = string> extends FormFieldProps<T | null> {
  options: SelectOption<T>[];
  direction?: 'horizontal' | 'vertical';
}

// Textarea props
export interface TextareaProps extends FormFieldProps<string> {
  rows?: number;
  maxLength?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

// Date picker props
export interface DatePickerProps extends FormFieldProps<Date | string | null> {
  minDate?: Date | string;
  maxDate?: Date | string;
  format?: string;
  showTime?: boolean;
}

// Date range picker props
export interface DateRangePickerProps extends FormFieldProps<[Date | null, Date | null]> {
  minDate?: Date | string;
  maxDate?: Date | string;
  format?: string;
}

// File input props
export interface FileInputProps extends FormFieldProps<File | File[] | null> {
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
}

// Form validation rule
export interface ValidationRule<T = unknown> {
  type: 'required' | 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern' | 'custom';
  value?: T;
  message: string;
  validate?: (value: T) => boolean;
}

// Form validation schema
export type ValidationSchema<T extends Record<string, unknown>> = {
  [K in keyof T]?: ValidationRule[];
};

// Form submission handler
export type FormSubmitHandler<T> = (values: T) => void | Promise<void>;

// Form reset handler
export type FormResetHandler = () => void;
