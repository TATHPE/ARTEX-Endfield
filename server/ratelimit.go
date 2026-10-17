package server

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Global API rate limiting. Login already has its own lockout; this is the
// coarse DoS guard the audit noted was missing, plus the X-RateLimit-* headers
// it also flagged. A desktop UI fires a burst of calls per page (plus one
// long-lived SSE request), so the window is deliberately generous: it stops a
// runaway loop, not a human.
const (
	apiRateLimitPerWindow      = 600             // requests per window per client
	apiRateWindow     = time.Minute     // sliding window length
	apiRateSweepEvery = 5 * time.Minute // prune idle clients
)

type apiRateEntry struct {
	stamps []time.Time
	seen   time.Time
}

type apiRateLimiter struct {
	mu      sync.Mutex
	clients map[string]*apiRateEntry
	lastGC  time.Time
}

func newAPIRateLimiter() *apiRateLimiter {
	return &apiRateLimiter{clients: map[string]*apiRateEntry{}, lastGC: time.Now()}
}

var apiLimiter = newAPIRateLimiter()

// allow records one request and reports whether it fits the window, along with
// the remaining budget and how long until the window frees up.
func (l *apiRateLimiter) allow(key string, now time.Time) (bool, int, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if now.Sub(l.lastGC) > apiRateSweepEvery {
		for k, e := range l.clients {
			if now.Sub(e.seen) > apiRateWindow {
				delete(l.clients, k)
			}
		}
		l.lastGC = now
	}

	e := l.clients[key]
	if e == nil {
		e = &apiRateEntry{}
		l.clients[key] = e
	}
	e.seen = now

	cutoff := now.Add(-apiRateWindow)
	kept := e.stamps[:0]
	for _, ts := range e.stamps {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	e.stamps = kept

	if len(e.stamps) >= apiRateLimitPerWindow {
		oldest := e.stamps[0]
		return false, 0, oldest.Add(apiRateWindow).Sub(now)
	}
	e.stamps = append(e.stamps, now)
	return true, apiRateLimitPerWindow - len(e.stamps), 0
}

// apiRateLimitPerWindow is the middleware wrapper for the /api/ tree.
func apiRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok, remaining, retry := apiLimiter.allow(clientIPOf(r), time.Now())
		h := w.Header()
		h.Set("X-RateLimit-Limit", strconv.Itoa(apiRateLimitPerWindow))
		h.Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
		if !ok {
			secs := int(retry.Seconds()) + 1
			h.Set("Retry-After", strconv.Itoa(secs))
			h.Set("X-RateLimit-Reset", strconv.Itoa(secs))
			writeErr(w, 429, "请求过于频繁，请稍后再试")
			return
		}
		next.ServeHTTP(w, r)
	})
}
