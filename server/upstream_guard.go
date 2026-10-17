package server

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateUpstreamBaseURL is the single choke point for user-supplied model
// endpoints: POST /api/llm/test and POST /api/llm/models both make the server
// dial whatever base_url the caller sends, which is an SSRF surface once a
// request reaches the API (the agent could be steered into reading cloud
// metadata or probing internal services).
//
// Policy: http/https only, no userinfo, and never a link-local / unspecified /
// multicast target (169.254.0.0/16 covers the cloud metadata endpoint,
// fe80::/10 the IPv6 equivalent). Loopback and RFC1918 stay allowed on purpose:
// the app is a single-user desktop tool whose documented setup is a local or
// self-hosted model server.
func validateUpstreamBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil // empty = provider default
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("base_url 无法解析: %v", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return fmt.Errorf("base_url 只允许 http/https，收到 %q", u.Scheme)
	}
	if u.User != nil {
		return fmt.Errorf("base_url 不允许携带用户名/密码")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("base_url 缺少主机名")
	}
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	// Classic cloud metadata hostnames (resolved by the metadata service itself).
	switch lower {
	case "metadata", "metadata.google.internal", "metadata.azure.internal", "instance-data":
		return fmt.Errorf("拒绝访问云元数据地址: %s", host)
	}
	if ip := net.ParseIP(lower); ip != nil {
		if ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("拒绝访问链路本地/组播/未指定地址: %s", host)
		}
	}
	return nil
}
