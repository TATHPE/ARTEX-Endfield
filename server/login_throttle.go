package server

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Login throttling. The desktop shell proxies every request from 127.0.0.1, so
// an IP key collapses to a single bucket for a normal single-user install: five
// consecutive wrong passwords lock logins for a minute, doubling per further
// five failures up to 15 minutes. A successful login clears the counter.
//
// The state is deliberately in-memory: a restart clears it, which is what a
// single-user local app wants (no DB rows to get stuck in a locked state).
const (
	loginFailThreshold = 5
	loginBaseLock      = 60 * time.Second
	loginMaxLock       = 15 * time.Minute
)

type loginFailEntry struct {
	count int
	until time.Time
}

type loginThrottle struct {
	mu    sync.Mutex
	fails map[string]*loginFailEntry
}

var loginLimiter = &loginThrottle{fails: map[string]*loginFailEntry{}}

func clientIPOf(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// blockedFor reports how long this client must wait before a login attempt.
func (t *loginThrottle) blockedFor(key string) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.fails[key]
	if e == nil || e.until.IsZero() {
		return 0
	}
	if wait := time.Until(e.until); wait > 0 {
		return wait
	}
	return 0
}

// recordFailure increments the counter and returns the lock duration applied
// (zero until the threshold is reached).
func (t *loginThrottle) recordFailure(key string) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.fails[key]
	if e == nil {
		e = &loginFailEntry{}
		t.fails[key] = e
	}
	e.count++
	if e.count < loginFailThreshold {
		return 0
	}
	level := e.count / loginFailThreshold // 1, 2, 3 ...
	lock := loginBaseLock
	for i := 1; i < level; i++ {
		lock *= 2
		if lock >= loginMaxLock {
			lock = loginMaxLock
			break
		}
	}
	e.until = time.Now().Add(lock)
	return lock
}

// recordSuccess clears the bucket for this client.
func (t *loginThrottle) recordSuccess(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.fails, key)
}
