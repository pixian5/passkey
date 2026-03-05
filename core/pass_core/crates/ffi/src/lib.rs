use std::os::raw::c_char;

static VERSION_STR: &[u8] = b"0.1.0\0";

#[no_mangle]
pub extern "C" fn pass_core_version() -> *const c_char {
    VERSION_STR.as_ptr().cast()
}

#[no_mangle]
pub extern "C" fn pass_core_compare_bounds(
    a_lower_ms: i64,
    a_upper_ms: i64,
    b_lower_ms: i64,
    b_upper_ms: i64,
) -> i32 {
    if a_upper_ms < b_lower_ms {
        -1
    } else if b_upper_ms < a_lower_ms {
        1
    } else {
        0
    }
}

