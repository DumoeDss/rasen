//! Windows process-authority helper entry point.

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    {
        rasen_windows_process_authority::cli::run()
    }
    #[cfg(not(windows))]
    {
        eprintln!("rasen-windows-process-authority runs on Windows only");
        std::process::ExitCode::from(78)
    }
}
