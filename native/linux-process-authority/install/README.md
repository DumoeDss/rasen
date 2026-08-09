# Linux process-authority broker installation assets

These files describe the explicit privileged installation. Nothing in the provider's
`prepare` path invokes them. Copying the npm package does not install, enable, or contact
the broker.

An administrator first copies the installer directory, the exact source-built broker
binary, the 32-byte Ed25519 private seed, and its canonical public-key manifest into an
absolute root-owned staging tree whose files and ancestors are not group/other writable.
`install.sh` refuses any other source provenance. The script pins a system-only `PATH`,
snapshots every source inode and SHA-256 digest, verifies those snapshots before and after
copy, and verifies the staged destination before atomic replacement. It has no `sudo`
path: it must already run as uid 0, validates its fixed destination parents, and is
idempotent when installed digests already match. Key replacement is refused while any
durable lease exists.

`uninstall.sh` stops before mutation when service stop or exact main-PID proof fails, when
the daemon singleton cannot be acquired, when a durable lease exists, or when any service
cgroup leaf reports `populated=1`. It holds the singleton through validation and removal,
and removes only the fixed layout and empty directories.
The scripts are installation assets; repository verification must not execute them against
the host. A real install/uninstall receipt remains part of the dedicated privileged Linux
gate, not unit or cross-compile evidence.

The daemon routes authenticated prepare, publication, activation, runtime, inspection,
abort, and termination requests through one `BrokerServiceCore`. A root-owned singleton
prevents concurrent daemons, and restart removes only an identity-validated socket that
refuses connections. These source contracts do not themselves constitute a supported
provider installation claim: the real installed lifecycle and writable unified cgroup-v2
matrix remains a dedicated privileged Linux gate.
