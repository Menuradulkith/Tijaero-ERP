#!/usr/bin/env python3
"""
Test script for syscode generation from paid amounts.
Demonstrates the digit-to-alphabet conversion logic.
"""

def generate_syscode_from_amount(amount: float) -> str:
    """
    Generate syscode from paid amount.
    Rounds amount to nearest integer and converts each digit to alphabet (0-A, 1-B, etc).
    
    Example: 1234.56 -> 1235 -> "BCDE"
    
    Args:
        amount: The paid amount as float
        
    Returns:
        String with alphabet characters representing each digit
    """
    # Round to nearest integer
    rounded_amount = round(amount)
    
    # Convert to string to get individual digits
    amount_str = str(abs(int(rounded_amount)))
    
    # Convert each digit to alphabet (0=A, 1=B, 2=C, ..., 9=J)
    digit_to_letter = {
        '0': 'A', '1': 'B', '2': 'C', '3': 'D', '4': 'E',
        '5': 'F', '6': 'G', '7': 'H', '8': 'I', '9': 'J'
    }
    
    syscode = ''.join(digit_to_letter.get(digit, 'A') for digit in amount_str)
    
    return syscode if syscode else 'A'  # Return 'A' if amount is 0


# Test cases
test_cases = [
    (0, "A"),           # 0 rounds to 0 -> "A"
    (1, "B"),           # 1 rounds to 1 -> "B"
    (10, "BA"),         # 10 rounds to 10 -> "BA"
    (123, "BCD"),       # 123 rounds to 123 -> "BCD"
    (1234.56, "BCDF"),  # 1234.56 rounds to 1235 -> "BCDF"
    (1234.4, "BCDE"),   # 1234.4 rounds to 1234 -> "BCDE"
    (9876.5, "JIHG"),   # 9876.5 rounds to 9877 -> "JIHG"
    (555.99, "FFG"),    # 555.99 rounds to 556 -> "FFG"
    (1000, "BAAA"),     # 1000 rounds to 1000 -> "BAAA"
]

print("=" * 70)
print("SYSCODE GENERATION TEST - Paid Amount to Alphabet Conversion")
print("=" * 70)
print()
print("Mapping: 0→A, 1→B, 2→C, 3→D, 4→E, 5→F, 6→G, 7→H, 8→I, 9→J")
print()
print(f"{'Paid Amount':<20} {'Rounded':<15} {'Expected':<15} {'Generated':<15} {'Status':<10}")
print("-" * 70)

all_passed = True
for amount, expected in test_cases:
    rounded = round(amount)
    generated = generate_syscode_from_amount(amount)
    status = "✅ PASS" if generated == expected else "❌ FAIL"
    if generated != expected:
        all_passed = False
    print(f"{amount:<20} {rounded:<15} {expected:<15} {generated:<15} {status:<10}")

print()
print("=" * 70)
if all_passed:
    print("✅ ALL TESTS PASSED")
else:
    print("❌ SOME TESTS FAILED")
print("=" * 70)
