package server

import "testing"

func TestValidateUpstreamBaseURL(t *testing.T) {
	cases := []struct {
		url    string
		ok     bool
		reason string
	}{
		{"", true, "empty means provider default"},
		{"https://api.deepseek.com/v1", true, "public https"},
		{"http://127.0.0.1:11434/v1", true, "local model server stays allowed"},
		{"http://192.168.1.5:8000/v1", true, "self-hosted LAN model server"},
		{"https://[::1]:8080/v1", true, "ipv6 loopback"},

		{"file:///C:/Windows/win.ini", false, "non-http scheme"},
		{"gopher://127.0.0.1:6379/", false, "non-http scheme"},
		{"https://user:pass@api.example.com/v1", false, "userinfo smuggling"},
		{"http://169.254.169.254/latest/meta-data/", false, "cloud metadata ip"},
		{"http://[fe80::1]/", false, "ipv6 link-local"},
		{"http://0.0.0.0:8080/", false, "unspecified address"},
		{"http://metadata.google.internal/computeMetadata/v1/", false, "metadata hostname"},
	}

	for _, c := range cases {
		err := validateUpstreamBaseURL(c.url)
		if c.ok && err != nil {
			t.Errorf("%q should be allowed (%s), got %v", c.url, c.reason, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%q should be rejected (%s)", c.url, c.reason)
		}
	}
}
