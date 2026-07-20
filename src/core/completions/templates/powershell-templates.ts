/**
 * Static template strings for PowerShell completion scripts.
 * These are PowerShell-specific helper functions that never change.
 */

export const POWERSHELL_DYNAMIC_HELPERS = `# Dynamic completion helpers

function Get-OpenSpecChanges {
    $output = rasen __complete changes 2>$null
    if ($output) {
        $output | ForEach-Object {
            ($_ -split "\\t")[0]
        }
    }
}

function Get-OpenSpecSpecs {
    $output = rasen __complete specs 2>$null
    if ($output) {
        $output | ForEach-Object {
            ($_ -split "\\t")[0]
        }
    }
}

function Get-OpenSpecSchemas {
    $output = rasen __complete schemas 2>$null
    if ($output) {
        $output | ForEach-Object {
            ($_ -split "\\t")[0]
        }
    }
}

function Get-RasenProfiles {
    $output = rasen __complete profiles 2>$null
    if ($output) {
        $output | ForEach-Object {
            ($_ -split "\\t")[0]
        }
    }
}

function Get-RasenSavedProfiles {
    $output = rasen __complete saved-profiles 2>$null
    if ($output) {
        $output | ForEach-Object {
            ($_ -split "\\t")[0]
        }
    }
}
`;
