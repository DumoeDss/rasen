//! Windows process-authority guardian entry point.
//!
//! The guardian lives **outside** the Job and holds its only handle. It is a separate binary
//! from the helper on purpose: the helper is a short-lived CLI the controller invokes, while
//! the guardian outlives its controller so a replacement controller can recover the same
//! authority.

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    {
        rasen_windows_process_authority::guardian::run()
    }
    #[cfg(not(windows))]
    {
        eprintln!("rasen-windows-process-authority-guardian runs on Windows only");
        std::process::ExitCode::from(78)
    }
}
