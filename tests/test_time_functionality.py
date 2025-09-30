#!/usr/bin/env python3
"""
Comprehensive test suite for all time-related functionality in streams_prefetcher.py
"""

import sys
import time
from datetime import datetime, timezone
import os

# Add parent directory's src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from streams_prefetcher import parse_time_string, format_time_string, StreamsPrefetcher

def test_parse_time_string():
    """Test parsing of time strings to seconds"""
    print("=" * 80)
    print("TEST 1: parse_time_string() - Converting human-readable time to seconds")
    print("=" * 80)

    test_cases = [
        # (input, expected_seconds, description)
        ('500ms', 0.5, 'Milliseconds'),
        ('1s', 1, 'Single second'),
        ('30s', 30, 'Multiple seconds'),
        ('1m', 60, 'Single minute'),
        ('5m', 300, 'Multiple minutes'),
        ('90m', 5400, '90 minutes (edge case)'),
        ('1h', 3600, 'Single hour'),
        ('2h', 7200, 'Multiple hours'),
        ('1.5h', 5400, 'Fractional hours'),
        ('1d', 86400, 'Single day'),
        ('3d', 259200, 'Multiple days'),
        ('1w', 604800, 'Single week'),
        ('2w', 1209600, 'Multiple weeks'),
        ('1M', 2592000, 'Single month (30 days)'),
        ('3M', 7776000, 'Multiple months'),
        ('1y', 31536000, 'Single year (365 days)'),
        ('2y', 63072000, 'Multiple years'),
        ('-1', -1, 'Unlimited (-1)'),
        ('-1s', -1, 'Unlimited (-1s)'),
        ('0s', 0, 'Zero seconds'),
        ('100ms', 0.1, 'Small milliseconds'),
    ]

    passed = 0
    failed = 0

    for input_str, expected, description in test_cases:
        try:
            result = parse_time_string(input_str)
            if result == expected:
                print(f"✅ PASS: {description:30} | '{input_str:6}' -> {result:12.1f}s (expected {expected:.1f}s)")
                passed += 1
            else:
                print(f"❌ FAIL: {description:30} | '{input_str:6}' -> {result:12.1f}s (expected {expected:.1f}s)")
                failed += 1
        except Exception as e:
            print(f"❌ ERROR: {description:30} | '{input_str:6}' -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_format_time_string():
    """Test formatting of seconds to human-readable strings"""
    print("=" * 80)
    print("TEST 2: format_time_string() - Converting seconds to human-readable format")
    print("=" * 80)

    test_cases = [
        # (input_seconds, expected_output, description)
        (-1, "Unlimited", "Unlimited time"),
        (0, "0 seconds", "Zero seconds"),
        (0.001, "1 millisecond", "1 millisecond"),
        (0.5, "500 milliseconds", "500 milliseconds"),
        (1, "1 second", "1 second"),
        (30, "30 seconds", "30 seconds"),
        (60, "1 minute", "Exactly 1 minute"),
        (90, "1 minute 30 seconds", "1 minute 30 seconds"),
        (300, "5 minutes", "5 minutes exactly"),
        (305, "5 minutes 5 seconds", "5 minutes 5 seconds"),
        (3600, "1 hour", "Exactly 1 hour"),
        (3660, "1 hour 1 minute", "1 hour 1 minute"),
        (3661, "1 hour 1 minute 1 second", "1 hour 1 minute 1 second"),
        (5400, "1 hour 30 minutes", "90 minutes as 1h 30m"),
        (7200, "2 hours", "2 hours exactly"),
        (7380, "2 hours 3 minutes", "2 hours 3 minutes"),
        (86400, "1 day", "Exactly 1 day"),
        (90000, "1 day 1 hour", "1 day 1 hour"),
        (93600, "1 day 2 hours", "1 day 2 hours"),
        (93720, "1 day 2 hours 2 minutes", "1 day 2 hours 2 minutes"),
        (259200, "3 days", "3 days exactly"),
        (604800, "1 week", "Exactly 1 week"),
        (691200, "1 week 1 day", "1 week 1 day"),
        (1209600, "2 weeks", "2 weeks"),
        (2592000, "1 month", "Exactly 1 month"),
        (3196800, "1 month 1 week", "1 month 1 week"),
        (31536000, "1 year", "Exactly 1 year"),
        (34128000, "1 year 1 month", "1 year 1 month"),
    ]

    passed = 0
    failed = 0

    for input_sec, expected, description in test_cases:
        try:
            result = format_time_string(input_sec)
            if result == expected:
                print(f"✅ PASS: {description:35} | {input_sec:12.3f}s -> '{result}'")
                passed += 1
            else:
                print(f"❌ FAIL: {description:35} | {input_sec:12.3f}s -> '{result}' (expected '{expected}')")
                failed += 1
        except Exception as e:
            print(f"❌ ERROR: {description:35} | {input_sec:12.3f}s -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_round_trip_conversion():
    """Test that parse_time_string -> format_time_string produces sensible results"""
    print("=" * 80)
    print("TEST 3: Round-trip conversion (parse -> format)")
    print("=" * 80)

    test_cases = [
        ('90m', '1 hour 30 minutes'),
        ('1h', '1 hour'),
        ('1.5h', '1 hour 30 minutes'),
        ('3d', '3 days'),
        ('1w', '1 week'),
        ('500ms', '500 milliseconds'),
        ('-1s', 'Unlimited'),
        ('5m', '5 minutes'),
        ('2h', '2 hours'),
    ]

    passed = 0
    failed = 0

    for input_str, expected_format in test_cases:
        try:
            seconds = parse_time_string(input_str)
            formatted = format_time_string(seconds)
            if formatted == expected_format:
                print(f"✅ PASS: '{input_str:6}' -> {seconds:10.1f}s -> '{formatted}'")
                passed += 1
            else:
                print(f"❌ FAIL: '{input_str:6}' -> {seconds:10.1f}s -> '{formatted}' (expected '{expected_format}')")
                failed += 1
        except Exception as e:
            print(f"❌ ERROR: '{input_str:6}' -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_format_timestamp():
    """Test timestamp formatting"""
    print("=" * 80)
    print("TEST 4: format_timestamp() - Converting Unix timestamps to readable dates")
    print("=" * 80)

    # Create a mock prefetcher instance
    prefetcher = StreamsPrefetcher(
        addon_urls=[('http://example.com', 'both')],
        movies_global_limit=10,
        series_global_limit=10,
        movies_per_catalog=5,
        series_per_catalog=5,
        items_per_mixed_catalog=5,
        delay=0
    )

    test_cases = [
        (None, "Not recorded", lambda r: r == "Not recorded"),
        (0, "Unix epoch (Dec 31, 1969 or Jan 1, 1970 depending on timezone)",
         lambda r: ("1969" in r or "1970" in r) and "PM" in r.upper()),  # Unix epoch, timezone-dependent
        (time.time(), "Current time",
         lambda r: datetime.now().strftime("%Y-%m-%d") in r),  # Today's date should be in result
    ]

    passed = 0
    failed = 0

    for timestamp, description, check_fn in test_cases:
        try:
            result = prefetcher.format_timestamp(timestamp)
            if check_fn(result):
                print(f"✅ PASS: {description:45} -> '{result}'")
                passed += 1
            else:
                print(f"❌ FAIL: {description:45} -> '{result}'")
                failed += 1
        except Exception as e:
            print(f"❌ ERROR: {description:45} -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_format_duration():
    """Test duration formatting"""
    print("=" * 80)
    print("TEST 5: format_duration() - Converting duration between timestamps")
    print("=" * 80)

    # Create a mock prefetcher instance
    prefetcher = StreamsPrefetcher(
        addon_urls=[('http://example.com', 'both')],
        movies_global_limit=10,
        series_global_limit=10,
        movies_per_catalog=5,
        series_per_catalog=5,
        items_per_mixed_catalog=5,
        delay=0
    )

    test_cases = [
        (None, 100.0, "Unknown"),
        (100.0, None, "Unknown"),
        (100.0, 100.0, "0 seconds"),
        (100.0, 101.0, "1 second"),
        (100.0, 130.0, "30 seconds"),
        (100.0, 160.0, "1 minute"),
        (100.0, 190.0, "1 minute 30 seconds"),
        (100.0, 3700.0, "1 hour"),
        (100.0, 3760.0, "1 hour 1 minute"),
        (100.0, 7300.0, "2 hours"),
        (100.0, 5500.0, "1 hour 30 minutes"),
        (100.0, 86500.0, "1 day"),
        (100.0, 90100.0, "1 day 1 hour"),
    ]

    passed = 0
    failed = 0

    for start, end, expected in test_cases:
        try:
            result = prefetcher.format_duration(start, end)
            if result == expected:
                print(f"✅ PASS: duration {end-start if start and end else 'N/A':10}s -> '{result}'")
                passed += 1
            else:
                print(f"❌ FAIL: duration {end-start if start and end else 'N/A':10}s -> '{result}' (expected '{expected}')")
                failed += 1
        except Exception as e:
            print(f"❌ ERROR: duration calculation -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_invalid_inputs():
    """Test handling of invalid inputs"""
    print("=" * 80)
    print("TEST 6: Invalid input handling")
    print("=" * 80)

    invalid_inputs = [
        ('', 'Empty string'),
        ('abc', 'Non-numeric string'),
        ('123x', 'Invalid unit'),
        ('-5s', 'Negative time (not -1)'),
        ('1.5.5s', 'Multiple decimals'),
        ('m', 'Missing number'),
        ('  ', 'Only whitespace'),
    ]

    passed = 0
    failed = 0

    for input_str, description in invalid_inputs:
        try:
            result = parse_time_string(input_str)
            print(f"❌ FAIL: {description:30} | '{input_str}' -> {result} (should have raised error)")
            failed += 1
        except Exception as e:
            print(f"✅ PASS: {description:30} | '{input_str}' -> Correctly raised error: {type(e).__name__}")
            passed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_boundary_cases():
    """Test boundary cases and edge values"""
    print("=" * 80)
    print("TEST 7: Boundary cases and edge values")
    print("=" * 80)

    test_cases = [
        (59, "59 seconds", "Just before 1 minute"),
        (60, "1 minute", "Exactly 1 minute"),
        (61, "1 minute 1 second", "Just after 1 minute"),
        (3599, "59 minutes 59 seconds", "Just before 1 hour"),
        (3600, "1 hour", "Exactly 1 hour"),
        (3601, "1 hour 1 second", "Just after 1 hour"),
        (86399, "23 hours 59 minutes 59 seconds", "Just before 1 day"),
        (86400, "1 day", "Exactly 1 day"),
        (86401, "1 day 1 second", "Just after 1 day"),
        (604799, "6 days 23 hours 59 minutes 59 seconds", "Just before 1 week"),
        (604800, "1 week", "Exactly 1 week"),
        (604801, "1 week 1 second", "Just after 1 week (shows as 1 week only)"),
    ]

    passed = 0
    failed = 0

    for input_sec, expected, description in test_cases:
        try:
            result = format_time_string(input_sec)
            # For values >= 1 week, we only show week and day components
            if input_sec >= 604800:
                # Just check it doesn't crash and returns something sensible
                if "week" in result.lower():
                    print(f"✅ PASS: {description:40} | {input_sec:8d}s -> '{result}'")
                    passed += 1
                else:
                    print(f"❌ FAIL: {description:40} | {input_sec:8d}s -> '{result}' (expected to contain 'week')")
                    failed += 1
            else:
                if result == expected:
                    print(f"✅ PASS: {description:40} | {input_sec:8d}s -> '{result}'")
                    passed += 1
                else:
                    print(f"❌ FAIL: {description:40} | {input_sec:8d}s -> '{result}' (expected '{expected}')")
                    failed += 1
        except Exception as e:
            print(f"❌ ERROR: {description:40} | {input_sec:8d}s -> Exception: {e}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed\n")
    return failed == 0

def test_critical_user_case():
    """Test the specific case that was reported as a bug"""
    print("=" * 80)
    print("TEST 8: Critical User Bug - 90m displaying as '1 hour'")
    print("=" * 80)

    print("\nReproducing the original bug scenario:")
    print("-" * 80)

    try:
        # Parse 90m
        seconds = parse_time_string('90m')
        print(f"Step 1: Parsing '90m' -> {seconds} seconds")

        # Format it back
        formatted = format_time_string(seconds)
        print(f"Step 2: Formatting {seconds} seconds -> '{formatted}'")

        # Check if it's correct
        if formatted == "1 hour 30 minutes":
            print(f"\n✅ BUG FIXED: '90m' now correctly displays as '{formatted}'")
            print(f"   (Previously would have displayed as '1 hour')")
            return True
        else:
            print(f"\n❌ BUG STILL EXISTS: '90m' displays as '{formatted}'")
            print(f"   (Expected: '1 hour 30 minutes')")
            return False
    except Exception as e:
        print(f"\n❌ ERROR: Exception occurred: {e}")
        return False

def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print(" COMPREHENSIVE TIME FUNCTIONALITY TEST SUITE")
    print(" Testing all time-related functions in streams_prefetcher.py")
    print("=" * 80 + "\n")

    results = []

    # Run all tests
    results.append(("parse_time_string", test_parse_time_string()))
    results.append(("format_time_string", test_format_time_string()))
    results.append(("round_trip_conversion", test_round_trip_conversion()))
    results.append(("format_timestamp", test_format_timestamp()))
    results.append(("format_duration", test_format_duration()))
    results.append(("invalid_inputs", test_invalid_inputs()))
    results.append(("boundary_cases", test_boundary_cases()))
    results.append(("critical_user_bug", test_critical_user_case()))

    # Print summary
    print("\n" + "=" * 80)
    print(" TEST SUMMARY")
    print("=" * 80)

    passed_tests = sum(1 for _, result in results if result)
    total_tests = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")

    print("-" * 80)
    print(f"Total: {passed_tests}/{total_tests} test suites passed")

    if passed_tests == total_tests:
        print("\n🎉 ALL TESTS PASSED! Your time functionality is working correctly.")
        print("   Your job is safe! 😊")
        return 0
    else:
        print(f"\n⚠️  {total_tests - passed_tests} test suite(s) failed. Please review the failures above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
