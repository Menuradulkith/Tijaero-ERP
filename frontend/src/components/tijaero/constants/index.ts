/**
 * Tijaero ERP Constants
 * 
 * Centralized enums and constants for consistent use across the application.
 * These mirror the backend Python choices for form validation and display.
 */

// =============================================================================
// PERSON/EMPLOYEE RELATED
// =============================================================================

export const TITLE_CHOICES = [
  { value: 'mr', label: 'Mr' },
  { value: 'mrs', label: 'Mrs' },
  { value: 'miss', label: 'Miss' },
  { value: 'dr', label: 'Dr' },
] as const;

export const GENDER_CHOICES = [
  { value: 'm', label: 'Male' },
  { value: 'f', label: 'Female' },
  { value: 'u', label: 'Other' },
] as const;

export const CIVIL_CHOICES = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'separated', label: 'Separated' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'other', label: 'Other' },
] as const;

export const OCCUPATION_CHOICES = [
  { value: 'owner', label: 'Owner' },
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'sales_representative', label: 'Sales Representative' },
  { value: 'accountant', label: 'Accountant' },
] as const;

// =============================================================================
// PAYMENT METHODS
// =============================================================================

export const CUSTOMER_PAYMENT_METHOD = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit' },
] as const;

export const SUPPLIER_PAYMENT_METHOD = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card_amex', label: 'Card / Amex 3%' },
  { value: 'card_visa', label: 'Card / Visa 2.7%' },
  { value: 'card_mastercard', label: 'Card / Mastercard 2.7%' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
] as const;

export const SALES_RETURN_PAYMENT_METHOD = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Deduct from Credit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit_note', label: 'Credit Note' },
] as const;

// Simple payment method options for Purchasing (title case for UI)
export const PURCHASING_PAYMENT_METHOD = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Credit', label: 'Credit' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Online Payment', label: 'Online Payment' },
] as const;

// Generic payment methods (lowercase)
export const GENERIC_PAYMENT_METHOD = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
] as const;

// Card types
export const CARD_TYPE = [
  { value: 'VISA', label: 'Visa' },
  { value: 'MASTERCARD', label: 'Mastercard' },
  { value: 'AMEX', label: 'American Express' },
  { value: 'OTHER', label: 'Other' },
] as const;

// =============================================================================
// EXPENSES
// =============================================================================

export const EXPENSES_METHOD = [
  { value: 'meal_expenses', label: 'Meal Expenses' },
  { value: 'salary_expenses', label: 'Salary Expenses' },
  { value: 'utilities_expenses', label: 'Utilities Expenses' },
  { value: 'travel_expenses', label: 'Travel Expenses' },
  { value: 'commissions', label: 'Commissions' },
  { value: 'other_expenses', label: 'Other Expenses' },
] as const;

// =============================================================================
// PRODUCT/INVENTORY
// =============================================================================

export const PRODUCT_ITEM_TYPE = [
  { value: 'inventory', label: 'Inventory' },
  { value: 'service', label: 'Service' },
] as const;

// =============================================================================
// SERVICE JOB
// =============================================================================

export const SERVICE_JOB_STATUS = [
  { value: 'accepted_by_technician', label: 'Accepted by Technician' },
  { value: 'check_in_progress', label: 'Check in Progress' },
  { value: 'repair_in_progress_', label: 'Repair in Progress' },
  { value: 'received_from_supplier', label: 'Received from Supplier' },
  { value: 'parts_pending', label: 'Parts Pending' },
  { value: 'sent_to_supplier', label: 'Sent to Supplier' },
  { value: 'supplier_pending', label: 'Supplier Pending' },
  { value: 'rejected_by_supplier', label: 'Rejected by Supplier' },
  { value: 'replacement_accepted', label: 'Replacement Accepted' },
  { value: 'warranty_rejected', label: 'Warranty Rejected' },
  { value: 'cannot_repair', label: 'Cannot Repair' },
  { value: 'ready_to_collect', label: 'Ready to Collect' },
  { value: 'informed_to_customer', label: 'Informed to Customer' },
  { value: 'rejected_by_customer', label: 'Rejected by Customer' },
  { value: 'estimate_approval_pending_of_customer', label: 'Estimate Approval Pending of Customer' },
  { value: 'estimate_approved_by_customer', label: 'Estimate Approved by Customer' },
  { value: 'estimate_pending_sales_division', label: 'Estimate Pending - Sales Division' },
  { value: 'closed', label: 'Closed' },
] as const;

export const SERVICE_JOB_FAULT_TYPE = [
  { value: 'no_post_or_no_display', label: 'No Post or No Display' },
  { value: 'no_dispay_at_times', label: 'No Display at Times' },
  { value: 'series_of_beeps', label: 'Series of Beeps' },
  { value: 'no_power', label: 'No Power' },
  { value: 'no_power_at_times', label: 'No Power at Times' },
  { value: 'usb_not_recognizing', label: 'USB Not Recognizing' },
  { value: 'kb_or_mouse_not_responding', label: 'K/B or Mouse Not Responding' },
  { value: 'cpu_fan_failure', label: 'CPU Fan Failure' },
  { value: 'system_fan_failure', label: 'System Fan Failure' },
  { value: 'overheating', label: 'Overheating' },
  { value: 'boot_up_failure', label: 'Boot Up Failure' },
  { value: 'boot_files_corrupted', label: 'Boot Files Corrupted' },
  { value: 'cddvd_not_responding', label: 'CD/DVD Not Responding' },
  { value: 'bios_flash_error', label: 'BIOS Flash Error' },
  { value: 'checksum__cmos_error_date_and_time', label: 'Checksum / CMOS Error Date & Time' },
  { value: 'hdd_failure', label: 'HDD Failure' },
  { value: 'ram_failure', label: 'RAM Failure' },
  { value: 'cpu_failure', label: 'CPU Failure' },
  { value: 'mb_failure', label: 'M/B Failure' },
  { value: 'pci_slot_not_functioning', label: 'PCI Slot Not Functioning' },
  { value: 'pci_card_failure', label: 'PCI Card Failure' },
  { value: 'vga_failure', label: 'VGA Failure' },
  { value: 'blue_screen', label: 'Blue Screen' },
  { value: 'front_audio_not_detecting', label: 'Front Audio Not Detecting' },
  { value: 'no_sound', label: 'No Sound' },
  { value: 'mic_not_functioning', label: 'Mic Not Functioning' },
  { value: 'os_corruption', label: 'OS Corruption' },
  { value: 'virus_infected', label: 'Virus Infected' },
  { value: 'slow', label: 'Slow' },
  { value: 'frequent_check_disk', label: 'Frequent Check Disk' },
  { value: 'not_printing', label: 'Not Printing' },
  { value: 'not_scanning', label: 'Not Scanning' },
  { value: 'drivers_not_installed', label: 'Drivers Not Installed' },
  { value: 'driver_corruption', label: 'Driver Corruption' },
  { value: 'driver_not_available', label: 'Driver Not Available' },
  { value: 'blurred_screen', label: 'Blurred Screen' },
  { value: 'vdu_not_responding', label: 'VDU Not Responding' },
  { value: 'resolution_mismatch', label: 'Resolution Mismatch' },
  { value: 'burnt', label: 'Burnt' },
  { value: 'burn_marks', label: 'Burn Marks' },
  { value: 'physical_damage', label: 'Physical Damage' },
  { value: 'patches_on_screen', label: 'Patches on Screen' },
  { value: 'rusted__corroded__oxidized', label: 'Rusted / Corroded / Oxidized' },
  { value: 'pin_damage', label: 'Pin Damage' },
  { value: 'socket_damage', label: 'Socket Damage' },
  { value: 'device_detection_problem', label: 'Device Detection Problem' },
  { value: 'wifi_or_bluetooth_discovery_failure', label: 'WiFi or Bluetooth Discovery Failure' },
  { value: 'sticky_keys', label: 'Sticky Keys' },
  { value: 'certain_keys_are_not_working', label: 'Certain Keys Are Not Working' },
  { value: 'no_bakup', label: 'No Backup' },
  { value: 'faulty_switch', label: 'Faulty Switch' },
  { value: 'light_or_led_not_functioning', label: 'Light or LED Not Functioning' },
  { value: 'restarting', label: 'Restarting' },
  { value: 'vibration', label: 'Vibration' },
  { value: 'not_pinging', label: 'Not Pinging' },
  { value: 'webcam_is_not_clear', label: 'Webcam Is Not Clear' },
  { value: 'webcam_is_defective', label: 'Webcam Is Defective' },
  { value: 'dvd_not_writing__reading', label: 'DVD Not Writing / Reading' },
  { value: 'faulty_speaker', label: 'Faulty Speaker' },
  { value: 'installation', label: 'Installation' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'amc', label: 'AMC' },
] as const;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type TitleChoice = typeof TITLE_CHOICES[number]['value'];
export type GenderChoice = typeof GENDER_CHOICES[number]['value'];
export type CivilChoice = typeof CIVIL_CHOICES[number]['value'];
export type OccupationChoice = typeof OCCUPATION_CHOICES[number]['value'];
export type CustomerPaymentMethod = typeof CUSTOMER_PAYMENT_METHOD[number]['value'];
export type SupplierPaymentMethod = typeof SUPPLIER_PAYMENT_METHOD[number]['value'];
export type SalesReturnPaymentMethod = typeof SALES_RETURN_PAYMENT_METHOD[number]['value'];
export type PurchasingPaymentMethod = typeof PURCHASING_PAYMENT_METHOD[number]['value'];
export type GenericPaymentMethod = typeof GENERIC_PAYMENT_METHOD[number]['value'];
export type CardType = typeof CARD_TYPE[number]['value'];
export type ExpensesMethod = typeof EXPENSES_METHOD[number]['value'];
export type ProductItemType = typeof PRODUCT_ITEM_TYPE[number]['value'];
export type ServiceJobStatus = typeof SERVICE_JOB_STATUS[number]['value'];
export type ServiceJobFaultType = typeof SERVICE_JOB_FAULT_TYPE[number]['value'];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get label for a choice value
 */
export function getChoiceLabel<T extends { value: string; label: string }>(
  choices: readonly T[],
  value: string | undefined | null
): string {
  if (!value) return '';
  const choice = choices.find(c => c.value === value);
  return choice?.label || value;
}

/**
 * Convert choices to options for TSelect component
 */
export function choicesToSelectOptions<T extends { value: string; label: string }>(
  choices: readonly T[]
): { value: string; label: string }[] {
  return choices.map(c => ({ value: c.value, label: c.label }));
}

/**
 * Convert choices to options for Autocomplete component
 */
export function choicesToAutocompleteOptions<T extends { value: string; label: string }>(
  choices: readonly T[]
): { id: string; label: string }[] {
  return choices.map(c => ({ id: c.value, label: c.label }));
}
