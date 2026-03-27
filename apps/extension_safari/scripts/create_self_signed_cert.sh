#!/bin/zsh
set -euo pipefail

CERT_NAME="${1:-Pass Local Code Signing}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -Fq "\"${CERT_NAME}\""; then
  echo "证书已存在: ${CERT_NAME}"
  exit 0
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

cat > "${tmpdir}/openssl.cnf" <<EOF
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_codesign

[ dn ]
CN = ${CERT_NAME}
O = Pass Dev
C = CN

[ v3_codesign ]
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
basicConstraints = critical, CA:TRUE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout "${tmpdir}/pass-local-sign.key" \
  -out "${tmpdir}/pass-local-sign.crt" \
  -config "${tmpdir}/openssl.cnf" >/dev/null 2>&1

openssl pkcs12 -export \
  -legacy \
  -inkey "${tmpdir}/pass-local-sign.key" \
  -in "${tmpdir}/pass-local-sign.crt" \
  -out "${tmpdir}/pass-local-sign.p12" \
  -passout pass:passlocal >/dev/null 2>&1

security import "${tmpdir}/pass-local-sign.p12" \
  -k "${KEYCHAIN}" \
  -P passlocal \
  -T /usr/bin/codesign \
  -T /usr/bin/security >/dev/null

security add-trusted-cert \
  -d \
  -r trustRoot \
  -p codeSign \
  -k "${KEYCHAIN}" \
  "${tmpdir}/pass-local-sign.crt" >/dev/null

echo "已创建并信任自签代码签名证书: ${CERT_NAME}"
