package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAPIRateLimiterWindow(t *testing.T) {
	l := newAPIRateLimiter()
	now := time.Now()
	key := "127.0.0.1"

	for i := 0; i < apiRateLimitPerWindow; i++ {
		ok, remaining, retry := l.allow(key, now)
		if !ok {
			t.Fatalf("request %d should be allowed, retry=%v", i+1, retry)
		}
		if want := apiRateLimitPerWindow - (i + 1); remaining != want {
			t.Fatalf("request %d remaining = %d, want %d", i+1, remaining, want)
		}
	}

	ok, remaining, retry := l.allow(key, now)
	if ok {
		t.Fatal("request over the limit must be rejected")
	}
	if remaining != 0 {
		t.Fatalf("rejected request should report remaining=0, got %d", remaining)
	}
	if retry <= 0 || retry > apiRateWindow {
		t.Fatalf("retry should be inside the window, got %v", retry)
	}

	// After the window slides past the first request, one slot frees up.
	later := now.Add(apiRateWindow + time.Second)
	if ok, _, _ := l.allow(key, later); !ok {
		t.Fatal("a request after the window should be allowed again")
	}
}

func TestAPIRateLimitMiddlewareHeaders(t *testing.T) {
	handler := apiRateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "10.1.2.3:5555"
	handler.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-RateLimit-Limit"); got == "" {
		t.Fatal("X-RateLimit-Limit header missing")
	}
	if got := rec.Header().Get("X-RateLimit-Remaining"); got == "" {
		t.Fatal("X-RateLimit-Remaining header missing")
	}
}
