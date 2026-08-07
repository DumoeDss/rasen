#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

fail() {
  printf '%s\n' "rasen broker install: $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "must already run as uid 0 (this installer never invokes sudo)"
[ "$#" = 6 ] || fail "usage: install.sh --broker-binary PATH --private-key PATH --public-key-manifest PATH"
[ "$1" = "--broker-binary" ] || fail "first option must be --broker-binary"
[ "$3" = "--private-key" ] || fail "second option must be --private-key"
[ "$5" = "--public-key-manifest" ] || fail "third option must be --public-key-manifest"

broker_source=$2
private_key_source=$4
public_manifest_source=$6
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
service_source=$script_dir/rasen-linux-process-authority-broker.service

assert_secure_source() {
  source_file=$1
  case "$source_file" in
    /*) ;;
    *) fail "installation source is not absolute: $source_file" ;;
  esac
  current=$source_file
  first=1
  while [ "$current" != / ]; do
    [ -e "$current" ] && [ ! -L "$current" ] || fail "installation source ancestry is absent or symlinked: $current"
    if [ "$first" = 1 ]; then
      [ -f "$current" ] || fail "installation source is not a regular file: $current"
      first=0
    else
      [ -d "$current" ] || fail "installation source ancestor is not a directory: $current"
    fi
    [ "$(stat -c %u "$current")" = 0 ] || fail "installation source is not root-owned: $current"
    mode=$(stat -c %a "$current")
    permissions=$((0$mode))
    [ $((permissions & 022)) -eq 0 ] || fail "installation source is group/other writable: $current"
    current=$(dirname -- "$current")
  done
}

for source_file in "$broker_source" "$private_key_source" "$public_manifest_source" "$service_source"; do
  assert_secure_source "$source_file"
done
[ "$(wc -c < "$private_key_source" | tr -d ' ')" = 32 ] || fail "private key must be exactly one raw 32-byte Ed25519 seed"

source_digest() {
  digest_line=$(sha256sum -- "$1") || fail "cannot hash installation source: $1"
  printf '%s\n' "${digest_line%% *}"
}

source_identity() {
  stat -c %d:%i:%s -- "$1"
}

broker_digest=$(source_digest "$broker_source")
private_key_digest=$(source_digest "$private_key_source")
public_manifest_digest=$(source_digest "$public_manifest_source")
service_digest=$(source_digest "$service_source")
broker_identity=$(source_identity "$broker_source")
private_key_identity=$(source_identity "$private_key_source")
public_manifest_identity=$(source_identity "$public_manifest_source")
service_identity=$(source_identity "$service_source")

getent group rasen-authority >/dev/null 2>&1 || fail "dedicated rasen-authority group must already exist"
service_gid=$(getent group rasen-authority | awk -F: 'NR == 1 { print $3 }')
[ -n "$service_gid" ] && [ "$service_gid" != 0 ] || fail "dedicated service group gid is invalid"

assert_secure_existing_parent() {
  current=$1
  while [ "$current" != / ]; do
    [ ! -L "$current" ] || fail "installation parent is a symlink: $current"
    if [ -e "$current" ]; then
      [ -d "$current" ] || fail "installation parent is not a directory: $current"
      [ "$(stat -c %u "$current")" = 0 ] || fail "installation parent is not root-owned: $current"
      mode=$(stat -c %a "$current")
      permissions=$((0$mode))
      [ $((permissions & 022)) -eq 0 ] || fail "installation parent is group/other writable: $current"
    fi
    current=$(dirname -- "$current")
  done
}

lease_root=/var/lib/rasen/linux-process-authority/leases
for parent in /usr/libexec/rasen /etc/rasen/linux-process-authority /var/lib/rasen/linux-process-authority "$lease_root" /run/rasen/linux-process-authority /usr/lib/systemd/system; do
  assert_secure_existing_parent "$parent"
done
if [ -d "$lease_root" ]; then
  [ "$(stat -c %u:%g:%a "$lease_root")" = "0:0:700" ] || fail "lease store is not root-owned mode 0700"
fi

lease_entry=
if [ -d "$lease_root" ]; then
  lease_entry=$(find "$lease_root" -mindepth 1 -maxdepth 1 -print -quit) || fail "cannot inspect durable lease state"
fi
if [ -n "$lease_entry" ]; then
  if [ ! -f /var/lib/rasen/linux-process-authority/broker.key ] || [ -L /var/lib/rasen/linux-process-authority/broker.key ] || [ "$(source_digest /var/lib/rasen/linux-process-authority/broker.key)" != "$private_key_digest" ]; then
    fail "key rotation is refused while a durable lease exists"
  fi
  if [ ! -f /etc/rasen/linux-process-authority/broker-public-key.manifest ] || [ -L /etc/rasen/linux-process-authority/broker-public-key.manifest ] || [ "$(source_digest /etc/rasen/linux-process-authority/broker-public-key.manifest)" != "$public_manifest_digest" ]; then
    fail "public identity replacement is refused while a durable lease exists"
  fi
fi

install -d -o root -g root -m 0755 /usr/libexec/rasen /etc/rasen/linux-process-authority
install -d -o root -g root -m 0700 /var/lib/rasen/linux-process-authority "$lease_root"
install -d -o root -g rasen-authority -m 0750 /run/rasen/linux-process-authority

install_if_changed() {
  source_file=$1
  destination=$2
  owner=$3
  group=$4
  mode=$5
  expected_digest=$6
  expected_identity=$7
  [ ! -L "$destination" ] || fail "installation target is a symlink: $destination"
  if [ -e "$destination" ]; then
    [ "$(stat -c %u "$destination")" = 0 ] || fail "installation target is not root-owned: $destination"
  fi
  [ "$(source_identity "$source_file")" = "$expected_identity" ] || fail "installation source identity changed before copy: $source_file"
  [ "$(source_digest "$source_file")" = "$expected_digest" ] || fail "installation source digest changed before copy: $source_file"
  if [ -f "$destination" ] && [ ! -L "$destination" ] && [ "$(source_digest "$destination")" = "$expected_digest" ] && [ "$(stat -c %u:%g:%a "$destination")" = "$owner:$group:$mode" ]; then
    return 0
  fi
  temp=$destination.tmp.$$
  trap 'rm -f -- "$temp"' EXIT HUP INT TERM
  install -o "$owner" -g "$group" -m "$mode" "$source_file" "$temp"
  [ "$(source_identity "$source_file")" = "$expected_identity" ] || fail "installation source identity changed during copy: $source_file"
  [ "$(source_digest "$source_file")" = "$expected_digest" ] || fail "installation source digest changed during copy: $source_file"
  [ "$(source_digest "$temp")" = "$expected_digest" ] || fail "staged installation digest differs: $destination"
  mv -f -- "$temp" "$destination"
  trap - EXIT HUP INT TERM
}

install_if_changed "$broker_source" /usr/libexec/rasen/rasen-linux-process-authority-broker 0 0 755 "$broker_digest" "$broker_identity"
install_if_changed "$public_manifest_source" /etc/rasen/linux-process-authority/broker-public-key.manifest 0 0 644 "$public_manifest_digest" "$public_manifest_identity"
install_if_changed "$private_key_source" /var/lib/rasen/linux-process-authority/broker.key 0 0 600 "$private_key_digest" "$private_key_identity"
install_if_changed "$service_source" /usr/lib/systemd/system/rasen-linux-process-authority-broker.service 0 0 644 "$service_digest" "$service_identity"

systemctl daemon-reload
systemctl enable --now rasen-linux-process-authority-broker.service
