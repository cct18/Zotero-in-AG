import re
import socket
import ipaddress
import urllib.parse
from typing import Optional

KEY_REGEX = re.compile(r"^[A-Za-z0-9]{8}$")

def validate_8char_key(key: Optional[str]) -> bool:
    """
    Validates standard Zotero 8-character alphanumeric keys strictly.
    Protects against path traversal and invalid SQL lookups.
    """
    if not key or not isinstance(key, str):
        return False
    return bool(KEY_REGEX.match(key))

def normalize_and_validate_chat_endpoint(base_url: Optional[str]) -> str:
    """
    Normalizes custom LLM endpoint and enforces protocol & SSRF protection against cloud metadata.
    Guards against standard IPv4/IPv6, integer, hexadecimal, and inet_aton variants of link-local metadata.
    """
    url = (base_url or "").strip().rstrip('/')
    if not url:
        return "https://api.deepseek.com/v1/chat/completions"

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"不支持的协议 '{parsed.scheme}'，仅支持 http:// 或 https://")

    hostname = (parsed.hostname or "").lower().strip()
    if not hostname:
        raise ValueError("无效的请求地址：缺失主机名 (Missing hostname)")

    # 1. Direct cloud metadata hostname blacklist
    if hostname in ("metadata.google.internal", "instance-data"):
        raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")

    # 2. Hexadecimal integer (e.g. 0xa9fe01a9) or decimal integer (e.g. 2852039166)
    val = None
    if re.match(r"^0x[0-9a-f]+$", hostname):
        try:
            val = int(hostname, 16)
        except ValueError:
            pass
    elif hostname.isdigit():
        try:
            val = int(hostname)
        except ValueError:
            pass

    if val is not None:
        try:
            ip = ipaddress.ip_address(val)
            if ip.is_link_local:
                raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")
        except ValueError as val_ex:
            if "禁止访问" in str(val_ex):
                raise

    # 3. Standard IPv4 / IPv6 parsing
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_link_local:
            raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")
    except ValueError as ex:
        if "禁止访问" in str(ex):
            raise

    # 4. socket.inet_aton fallback for dotted hex (0xa9.0xfe.0x01.0xa9) or octal notation
    try:
        packed = socket.inet_aton(hostname)
        ip = ipaddress.ip_address(packed)
        if ip.is_link_local:
            raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")
    except Exception as aton_ex:
        if "禁止访问" in str(aton_ex):
            raise

    # 5. String prefix fallback
    if hostname.startswith("169.254."):
        raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")

    if url.endswith("/chat/completions"):
        return url
    if url.endswith("/v1"):
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"
