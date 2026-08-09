#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

fail() {
  printf '%s\n' "rasen broker uninstall: $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "must already run as uid 0 (this uninstaller never invokes sudo)"
[ "$#" = 0 ] || fail "usage: uninstall.sh"

# Close the request race before inspecting durable and kernel authority state. A refused
# uninstall deliberately leaves the authority service stopped while its leases remain.
systemctl stop rasen-linux-process-authority-broker.service || fail "broker service stop failed; recovery assets are unchanged"
if systemctl is-active --quiet rasen-linux-process-authority-broker.service; then
  fail "broker service remains active after stop; recovery assets are unchanged"
fi

runtime_root=/run/rasen/linux-process-authority
lock_path=$runtime_root/broker.lock
[ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] || fail "broker runtime directory is absent or symlinked"
[ ! -L "$lock_path" ] || fail "broker administrative lock is symlinked"
exec 9>"$lock_path"
flock -n 9 || fail "broker administrative singleton remains held"
chmod 0600 "$lock_path"
chown root:root "$lock_path"
main_pid=$(systemctl show --property MainPID --value rasen-linux-process-authority-broker.service) || fail "cannot prove broker service pid state"
[ "$main_pid" = 0 ] || fail "broker service retains a live main pid"

lease_root=/var/lib/rasen/linux-process-authority/leases
cgroup_root=/sys/fs/cgroup/rasen-linux-process-authority

assert_secure_existing_directory() {
  current=$1
  while [ "$current" != / ]; do
    [ ! -L "$current" ] || fail "administrative parent is a symlink: $current"
    if [ -e "$current" ]; then
      [ -d "$current" ] || fail "administrative parent is not a directory: $current"
      [ "$(stat -c %u "$current")" = 0 ] || fail "administrative parent is not root-owned: $current"
      mode=$(stat -c %a "$current")
      permissions=$((0$mode))
      [ $((permissions & 022)) -eq 0 ] || fail "administrative parent is group/other writable: $current"
    fi
    current=$(dirname -- "$current")
  done
}

for parent in /usr/libexec/rasen /etc/rasen/linux-process-authority /var/lib/rasen/linux-process-authority "$lease_root" /run/rasen/linux-process-authority /usr/lib/systemd/system "$cgroup_root"; do
  assert_secure_existing_directory "$parent"
done
if [ -d "$lease_root" ]; then
  [ "$(stat -c %u:%g:%a "$lease_root")" = "0:0:700" ] || fail "lease store is not root-owned mode 0700"
fi

lease_entry=
if [ -d "$lease_root" ]; then
  lease_entry=$(find "$lease_root" -mindepth 1 -maxdepth 1 -print -quit) || fail "cannot inspect durable lease state"
fi
if [ -d "$cgroup_root" ]; then
  for leaf in "$cgroup_root"/*; do
    [ -d "$leaf" ] || continue
    [ ! -L "$leaf" ] || fail "cgroup leaf is a symlink: $leaf"
    [ "$(stat -c %u "$leaf")" = 0 ] || fail "cgroup leaf is not root-owned: $leaf"
    mode=$(stat -c %a "$leaf")
    permissions=$((0$mode))
    [ $((permissions & 022)) -eq 0 ] || fail "cgroup leaf is group/other writable: $leaf"
    name=$(basename -- "$leaf")
    printf '%s\n' "$name" | grep -Eq '^lease-[0-9a-f]{32}$' || fail "unknown cgroup leaf name: $leaf"
    events=$leaf/cgroup.events
    [ -f "$events" ] || fail "cgroup leaf lacks cgroup.events: $leaf"
    [ ! -L "$events" ] || fail "cgroup event path is a symlink: $events"
    populated=$(awk '
      $1 == "populated" {
        if (NF != 2 || ($2 != "0" && $2 != "1") || found) exit 2
        found=1
        value=$2
      }
      END {
        if (!found) exit 3
        print value
      }
    ' "$events") || fail "cgroup.events is malformed: $events"
    [ "$populated" = 0 ] || fail "a broker cgroup leaf remains populated: $leaf"
  done
fi

for target in /run/rasen/linux-process-authority/broker.sock /run/rasen/linux-process-authority/broker.lock /usr/lib/systemd/system/rasen-linux-process-authority-broker.service /etc/rasen/linux-process-authority/broker-public-key.manifest /var/lib/rasen/linux-process-authority/broker.key /usr/libexec/rasen/rasen-linux-process-authority-broker; do
  [ ! -L "$target" ] || fail "refusing to remove symlinked install target: $target"
  if [ -e "$target" ]; then
    [ "$(stat -c %u "$target")" = 0 ] || fail "refusing to remove non-root-owned install target: $target"
  fi
done

broker_binary=/usr/libexec/rasen/rasen-linux-process-authority-broker
[ -x "$broker_binary" ] || fail "installed broker binary is absent or not executable"
"$broker_binary" clean-uninstall-state || fail "durable broker state is retained, incomplete, unauthenticated, or malformed"

# Remove the already-proven-empty kernel authority before its durable identity and recovery
# assets. Any cleanup race therefore fails with the broker still reinstallable/recoverable.
if [ -d "$cgroup_root" ]; then
  for leaf in "$cgroup_root"/lease-*; do
    [ -d "$leaf" ] || continue
    rmdir -- "$leaf" || fail "cgroup leaf is not empty: $leaf"
  done
  rmdir -- "$cgroup_root" || fail "broker cgroup subtree is not empty"
fi

systemctl disable rasen-linux-process-authority-broker.service
rm -f -- /run/rasen/linux-process-authority/broker.sock
rm -f -- /usr/lib/systemd/system/rasen-linux-process-authority-broker.service
rm -f -- /etc/rasen/linux-process-authority/broker-public-key.manifest
rm -f -- /var/lib/rasen/linux-process-authority/broker.key
rm -f -- /usr/libexec/rasen/rasen-linux-process-authority-broker
systemctl daemon-reload
rm -f -- "$lock_path"
rmdir -- "$lease_root" /var/lib/rasen/linux-process-authority /run/rasen/linux-process-authority /etc/rasen/linux-process-authority 2>/dev/null || true
