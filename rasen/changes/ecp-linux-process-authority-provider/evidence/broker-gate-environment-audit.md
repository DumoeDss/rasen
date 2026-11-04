# Broker actual-gate environment audit

Date: 2026-08-05

Scope: read-only local-host audit. No WSL distribution was started for the audit, and no file, VM, container, service, mount, cgroup, `.wslconfig`, or `wsl.conf` state was changed.

## Conclusion

No currently ready isolated Linux environment proves all Section 9 prerequisites: writable unified cgroup v2, required controllers, `cgroup.events`, `cgroup.kill`, root/admin authority, and namespace support. The broker actual-kernel gate therefore remains open.

## Observed facts

- Ordinary Ubuntu WSL remains the recorded primary-path environment. Its prior live receipt shows a hybrid hierarchy whose v2 mount lacks the required controllers, `cgroup.events`, and `cgroup.kill`.
- `wsl --list --verbose` showed `Ubuntu-24.04` and `docker-desktop` stopped during this audit. `.wslconfig` has `networkingMode=mirrored` and no pre-existing cgroup/systemd override.
- Windows 11 Pro build `26200` reports a hypervisor, firmware virtualization, about 63.3 GiB memory, and enabled Hyper-V/VirtualMachinePlatform/WSL features. The current process is not elevated; Hyper-V commands exposed no ready Linux VM.
- Docker CLI `28.3.2` names `desktop-linux`, but no Docker Desktop daemon/service/pipe was available and no server cgroup facts could be established.
- Podman, nerdctl, LXC/LXD, Multipass, Vagrant, QEMU, libvirt, Lima, Colima, Minikube, Kind, and `act` were unavailable. `kubectl` alone provides no cluster authority.
- Repository CI contains ordinary `ubuntu-latest` jobs only. It has no dedicated/self-hosted label, cgroup probe, privileged broker install, namespace mutation, or broker kill/empty gate.

## Ranked acquisition paths

1. Add a dedicated GitHub-hosted Ubuntu gate job whose first step proves the exact cgroup and namespace prerequisites, then uses runner `sudo` for the source-owned broker matrix. This requires workflow modification, a pushed revision, Actions execution, and receipt upload. Hosted-runner policy may still reject the gate.
2. Create a dedicated Hyper-V Linux VM. This requires Windows administrator authority, a Linux image, VM disk/network allocation, and explicit unified-cgroup configuration; it is the most controllable fallback.
3. Import and configure a dedicated WSL distribution. This additionally requires global WSL shutdown/restart and risks affecting ordinary WSL because `.wslconfig` is global.
4. Use a privileged Docker Desktop container only as a preflight unless it proves an isolated, writable host cgroup authority accepted by Section 9; a generic privileged container is not terminal evidence.

The preferred route is GitHub-hosted probe/gate, falling back to a dedicated Hyper-V VM. Either path requires explicit external-state authority at the point it is exercised.

## Evidence that remains non-terminal

Windows cross-target builds, the isolated WSL Rust toolchain, ordinary WSL namespace/pidfd receipts, an empty cgroup-v2 mount, mocks/fixtures, generic CI success, Hyper-V feature availability, Docker client state, and a container without proven host-cgroup authority cannot close Section 9. A successful environment probe alone also does not close Sections 9.2–9.7: real install ownership, authentication, restart, migration, drift, recursive kill, empty convergence, and independent security review remain mandatory.
