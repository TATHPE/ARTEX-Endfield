package server

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoginThrottleLocksAfterThreshold(t *testing.T) {
	l := &loginThrottle{fails: map[string]*loginFailEntry{}}
	key := "127.0.0.1"

	for i := 1; i < loginFailThreshold; i++ {
		if lock := l.recordFailure(key); lock != 0 {
			t.Fatalf("failure %d should not lock yet, got %v", i, lock)
		}
		if wait := l.blockedFor(key); wait != 0 {
			t.Fatalf("failure %d should not block yet, got %v", i, wait)
		}
	}

	lock := l.recordFailure(key)
	if lock != loginBaseLock {
		t.Fatalf("threshold failure should lock for %v, got %v", loginBaseLock, lock)
	}
	if wait := l.blockedFor(key); wait <= 0 || wait > loginBaseLock {
		t.Fatalf("blockedFor should report a wait inside the lock window, got %v", wait)
	}
}

func TestLoginThrottleEscalatesAndResets(t *testing.T) {
	l := &loginThrottle{fails: map[string]*loginFailEntry{}}
	key := "10.0.0.9"

	var last time.Duration
	for i := 0; i < loginFailThreshold*2; i++ {
		last = l.recordFailure(key)
	}
	if last != loginBaseLock*2 {
		t.Fatalf("two thresholds should double the lock, got %v", last)
	}
	if got := l.blockedFor(key); got <= 0 {
		t.Fatalf("expected to be blocked after escalation, got %v", got)
	}

	l.recordSuccess(key)
	if got := l.blockedFor(key); got != 0 {
		t.Fatalf("success must clear the bucket, got %v", got)
	}
}

func TestClientIPOf(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1:5555":      "127.0.0.1",
		"[::1]:8080":          "::1",
		"192.168.1.7:1":       "192.168.1.7",
		"127.0.0.1":           "127.0.0.1",
	}
	for in, want := range cases {
		r := httptest.NewRequest("POST", "/api/auth/login", nil)
		r.RemoteAddr = in
		if got := clientIPOf(r); got != want {
			t.Errorf("clientIPOf(%q) = %q, want %q", in, got, want)
		}
	}
}
