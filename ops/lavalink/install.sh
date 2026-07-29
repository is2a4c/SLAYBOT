#!/usr/bin/env bash
set -Eeuo pipefail

HYSTERIA_VERSION="2.10.0"
HYSTERIA_SHA256="04f7804159ef1d798de12a817d73aab4b9040ebe45fc62e223000c5c59e987fe"
LAVALINK_VERSION="4.2.2"
LAVALINK_SHA256="8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a"
TPROXY_MARK="0x2333"
TPROXY_TABLE="2333"
TPROXY_PORT="2500"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-install}"

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "This installer must run as root" >&2
    exit 1
  fi
}

service_exists() {
  systemctl cat "$1" >/dev/null 2>&1
}

status() {
  echo "=== services ==="
  for unit in hysteria-lavalink-routing hysteria-lavalink lavalink; do
    if service_exists "$unit.service"; then
      systemctl is-active "$unit.service" || true
    else
      echo "$unit: not installed"
    fi
  done

  echo "=== routing ==="
  ip rule show | grep -F "fwmark $TPROXY_MARK lookup $TPROXY_TABLE" || echo "policy rule missing"
  iptables -t mangle -S LAVALINK_MARK 2>/dev/null || echo "LAVALINK_MARK chain missing"
  iptables -t mangle -S LAVALINK_TPROXY 2>/dev/null || echo "LAVALINK_TPROXY chain missing"

  echo "=== listeners ==="
  ss -lntup | grep -E ":(2333|${TPROXY_PORT})\\b" || true

  echo "=== Lavalink API ==="
  if [[ -r /etc/lavalink/lavalink.env ]]; then
    # shellcheck disable=SC1091
    source /etc/lavalink/lavalink.env
    curl -fsS --max-time 5 -H "Authorization: $LAVALINK_SERVER_PASSWORD" \
      http://127.0.0.1:2333/v4/info |
      jq '{version:.version.semver, sourceManagers:.sourceManagers, filters:.filters}' || true
  else
    echo "Lavalink environment missing"
  fi
}

remove_routes() {
  if [[ -x /usr/local/sbin/lavalink-tproxy-routes ]]; then
    /usr/local/sbin/lavalink-tproxy-routes remove || true
    return
  fi

  iptables -t mangle -D OUTPUT -j LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -D PREROUTING -j LAVALINK_TPROXY 2>/dev/null || true
  iptables -t mangle -F LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -X LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -F LAVALINK_TPROXY 2>/dev/null || true
  iptables -t mangle -X LAVALINK_TPROXY 2>/dev/null || true
  ip rule del fwmark "$TPROXY_MARK" table "$TPROXY_TABLE" 2>/dev/null || true
  ip route flush table "$TPROXY_TABLE" 2>/dev/null || true
}

rollback() {
  echo "Stopping the isolated Lavalink stack"
  systemctl disable --now lavalink.service 2>/dev/null || true
  systemctl disable --now hysteria-lavalink.service 2>/dev/null || true
  systemctl disable --now hysteria-lavalink-routing.service 2>/dev/null || true
  remove_routes
  echo "Rollback complete; files were retained for inspection"
}

validate_inputs() {
  : "${HYSTERIA_AUTH:?HYSTERIA_AUTH is required}"
  : "${LAVALINK_LOCAL_PASSWORD:?LAVALINK_LOCAL_PASSWORD is required}"

  HYSTERIA_SERVER="${HYSTERIA_SERVER:-vpn.televibe.host}"
  HYSTERIA_PORT="${HYSTERIA_PORT:-18443}"
  HYSTERIA_SNI="${HYSTERIA_SNI:-$HYSTERIA_SERVER}"

  [[ "$HYSTERIA_SERVER" =~ ^[A-Za-z0-9.-]+$ ]] || {
    echo "Invalid HYSTERIA_SERVER" >&2
    exit 1
  }
  [[ "$HYSTERIA_SNI" =~ ^[A-Za-z0-9.-]+$ ]] || {
    echo "Invalid HYSTERIA_SNI" >&2
    exit 1
  }
  [[ "$HYSTERIA_PORT" =~ ^[0-9]{1,5}$ ]] && ((HYSTERIA_PORT >= 1 && HYSTERIA_PORT <= 65535)) || {
    echo "Invalid HYSTERIA_PORT" >&2
    exit 1
  }
  [[ "$HYSTERIA_AUTH" =~ ^[A-Za-z0-9._:@+-]{8,256}$ ]] || {
    echo "HYSTERIA_AUTH contains unsupported characters" >&2
    exit 1
  }
  [[ "$LAVALINK_LOCAL_PASSWORD" =~ ^[A-Za-z0-9._:@+-]{32,256}$ ]] || {
    echo "LAVALINK_LOCAL_PASSWORD must be at least 32 safe characters" >&2
    exit 1
  }
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    ca-certificates curl iproute2 iptables jq libcap2-bin openjdk-17-jre-headless
}

install_binaries() {
  local temp_dir
  temp_dir="$(mktemp -d)"

  curl -fsSL --retry 3 \
    "https://github.com/apernet/hysteria/releases/download/app/v${HYSTERIA_VERSION}/hysteria-linux-amd64" \
    -o "$temp_dir/hysteria"
  echo "$HYSTERIA_SHA256  $temp_dir/hysteria" | sha256sum -c -
  install -o root -g root -m 0755 "$temp_dir/hysteria" /usr/local/bin/hysteria
  setcap CAP_NET_ADMIN,CAP_NET_BIND_SERVICE+ep /usr/local/bin/hysteria

  curl -fsSL --retry 3 \
    "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar" \
    -o "$temp_dir/Lavalink.jar"
  echo "$LAVALINK_SHA256  $temp_dir/Lavalink.jar" | sha256sum -c -
  install -o lavalink -g lavalink -m 0644 "$temp_dir/Lavalink.jar" /opt/lavalink/Lavalink.jar
  rm -rf -- "$temp_dir"
}

create_accounts_and_directories() {
  getent group hysteria-lavalink >/dev/null || groupadd --system hysteria-lavalink
  id -u hysteria-lavalink >/dev/null 2>&1 ||
    useradd --system --gid hysteria-lavalink --home-dir /nonexistent --shell /usr/sbin/nologin hysteria-lavalink

  getent group lavalink >/dev/null || groupadd --system lavalink
  id -u lavalink >/dev/null 2>&1 ||
    useradd --system --gid lavalink --home-dir /opt/lavalink --shell /usr/sbin/nologin lavalink

  install -d -o hysteria-lavalink -g hysteria-lavalink -m 0750 /etc/hysteria-lavalink
  install -d -o lavalink -g lavalink -m 0750 /etc/lavalink /opt/lavalink /opt/lavalink/plugins /opt/lavalink/logs
}

write_configuration() {
  umask 077

  {
    printf 'server: %s:%s\n' "$HYSTERIA_SERVER" "$HYSTERIA_PORT"
    printf 'auth: %s\n' "$HYSTERIA_AUTH"
    printf 'tls:\n  sni: %s\n  insecure: false\n' "$HYSTERIA_SNI"
    printf 'quic:\n  keepAlivePeriod: 10s\n'
    printf 'tcpTProxy:\n  listen: 127.0.0.1:%s\n' "$TPROXY_PORT"
    printf 'udpTProxy:\n  listen: 127.0.0.1:%s\n  timeout: 2m\n' "$TPROXY_PORT"
  } >/etc/hysteria-lavalink/config.yaml
  chown hysteria-lavalink:hysteria-lavalink /etc/hysteria-lavalink/config.yaml
  chmod 0600 /etc/hysteria-lavalink/config.yaml

  printf 'LAVALINK_SERVER_PASSWORD=%s\n' "$LAVALINK_LOCAL_PASSWORD" >/etc/lavalink/lavalink.env
  chown lavalink:lavalink /etc/lavalink/lavalink.env
  chmod 0600 /etc/lavalink/lavalink.env

  install -o lavalink -g lavalink -m 0644 "$SCRIPT_DIR/application.yml" /opt/lavalink/application.yml
}

write_routing_helper() {
  cat >/usr/local/sbin/lavalink-tproxy-routes <<'ROUTES'
#!/usr/bin/env bash
set -Eeuo pipefail

MARK="0x2333"
TABLE="2333"
PORT="2500"

remove_rules() {
  iptables -t mangle -D OUTPUT -j LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -D PREROUTING -j LAVALINK_TPROXY 2>/dev/null || true
  iptables -t mangle -F LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -X LAVALINK_MARK 2>/dev/null || true
  iptables -t mangle -F LAVALINK_TPROXY 2>/dev/null || true
  iptables -t mangle -X LAVALINK_TPROXY 2>/dev/null || true
  ip rule del fwmark "$MARK" table "$TABLE" 2>/dev/null || true
  ip route flush table "$TABLE" 2>/dev/null || true
}

if [[ "${1:-apply}" == "remove" ]]; then
  remove_rules
  exit 0
fi

remove_rules

ip rule add fwmark "$MARK" table "$TABLE"
ip route add local default dev lo table "$TABLE"

iptables -t mangle -N LAVALINK_MARK
for subnet in \
  0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 \
  172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -t mangle -A LAVALINK_MARK -m owner --uid-owner lavalink -d "$subnet" -j RETURN
done
iptables -t mangle -A LAVALINK_MARK -m owner --uid-owner lavalink -p tcp -j MARK --set-mark "$MARK"
iptables -t mangle -A LAVALINK_MARK -m owner --uid-owner lavalink -p udp -j MARK --set-mark "$MARK"
iptables -t mangle -A OUTPUT -j LAVALINK_MARK

iptables -t mangle -N LAVALINK_TPROXY
iptables -t mangle -A LAVALINK_TPROXY -m mark ! --mark "$MARK" -j RETURN
for subnet in \
  0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 \
  172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -t mangle -A LAVALINK_TPROXY -d "$subnet" -j RETURN
done
iptables -t mangle -A LAVALINK_TPROXY -p tcp \
  -j TPROXY --on-ip 127.0.0.1 --on-port "$PORT" --tproxy-mark "$MARK/0xffffffff"
iptables -t mangle -A LAVALINK_TPROXY -p udp \
  -j TPROXY --on-ip 127.0.0.1 --on-port "$PORT" --tproxy-mark "$MARK/0xffffffff"
iptables -t mangle -A PREROUTING -j LAVALINK_TPROXY
ROUTES
  chmod 0755 /usr/local/sbin/lavalink-tproxy-routes
}

write_systemd_units() {
  cat >/etc/systemd/system/hysteria-lavalink-routing.service <<'UNIT'
[Unit]
Description=Policy routing for isolated Lavalink Hysteria tunnel
Before=hysteria-lavalink.service lavalink.service
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lavalink-tproxy-routes apply
ExecStop=/usr/local/sbin/lavalink-tproxy-routes remove
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

  cat >/etc/systemd/system/hysteria-lavalink.service <<'UNIT'
[Unit]
Description=Hysteria2 client for isolated Lavalink traffic
After=network-online.target hysteria-lavalink-routing.service
Requires=hysteria-lavalink-routing.service

[Service]
Type=simple
User=hysteria-lavalink
Group=hysteria-lavalink
ExecStart=/usr/local/bin/hysteria client -c /etc/hysteria-lavalink/config.yaml
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=/etc/hysteria-lavalink

[Install]
WantedBy=multi-user.target
UNIT

  cat >/etc/systemd/system/lavalink.service <<'UNIT'
[Unit]
Description=Local Lavalink v4 audio node
After=network-online.target hysteria-lavalink.service
Requires=hysteria-lavalink.service

[Service]
Type=simple
User=lavalink
Group=lavalink
WorkingDirectory=/opt/lavalink
EnvironmentFile=/etc/lavalink/lavalink.env
ExecStart=/usr/bin/java -Xms128m -Xmx1024m -Djava.net.preferIPv4Stack=true -jar /opt/lavalink/Lavalink.jar
Restart=always
RestartSec=5
TimeoutStartSec=180
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=/etc/lavalink
ReadWritePaths=/opt/lavalink

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
}

verify_tunnel() {
  systemctl enable --now hysteria-lavalink-routing.service
  systemctl enable --now hysteria-lavalink.service

  for _ in {1..20}; do
    if systemctl is-active --quiet hysteria-lavalink.service &&
      runuser -u lavalink -- curl -4fsS --max-time 8 -o /dev/null https://www.youtube.com/generate_204; then
      echo "Hysteria tunnel can reach YouTube as the lavalink user"
      return
    fi
    sleep 2
  done

  journalctl -u hysteria-lavalink.service -n 50 --no-pager >&2 || true
  echo "Hysteria tunnel verification failed" >&2
  return 1
}

verify_lavalink() {
  systemctl enable --now lavalink.service

  for _ in {1..45}; do
    if curl -fsS --max-time 5 -H "Authorization: $LAVALINK_LOCAL_PASSWORD" \
      http://127.0.0.1:2333/v4/info >/tmp/lavalink-info.json; then
      break
    fi
    sleep 2
  done

  jq -e '.version.semver and (.sourceManagers | index("youtube"))' /tmp/lavalink-info.json >/dev/null

  curl -fsSG --max-time 30 \
    -H "Authorization: $LAVALINK_LOCAL_PASSWORD" \
    --data-urlencode "identifier=ytsearch:Never Gonna Give You Up" \
    http://127.0.0.1:2333/v4/loadtracks >/tmp/lavalink-youtube.json
  jq -e '.loadType != "error" and .loadType != "empty" and (.data | length > 0)' \
    /tmp/lavalink-youtube.json >/dev/null

  rm -f /tmp/lavalink-info.json /tmp/lavalink-youtube.json
  echo "Lavalink API and YouTube search verification passed"
}

install_stack() {
  validate_inputs
  install_packages
  create_accounts_and_directories
  install_binaries
  write_configuration
  write_routing_helper
  write_systemd_units

  trap 'echo "Installation failed; rolling back isolated services" >&2; rollback' ERR
  verify_tunnel
  verify_lavalink
  trap - ERR

  status
}

require_root
case "$ACTION" in
  install)
    install_stack
    ;;
  status)
    status
    ;;
  rollback)
    rollback
    ;;
  *)
    echo "Usage: $0 {install|status|rollback}" >&2
    exit 2
    ;;
esac
