package agent

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"
)

// RequestLimiter counts HTTP attempts in rolling second/minute windows. Keep it
// outside provider caches so rebuilding a provider does not reset its quota.
// Its zero value is ready for use; limits are set by NewProviderWithLimiter.
type RequestLimiter struct {
	mu      sync.Mutex
	windows [2]requestWindow
	sent    []time.Time
	changed chan struct{}

	// jitter spreads waits so independent limiters do not retry in lockstep.
	// Off by default: timing-sensitive callers (and tests) stay deterministic.
	jitter bool
	// gate caps in-flight HTTP attempts; nil means unlimited. Rate limiting
	// alone lets a hundred goroutines pile up on the wire.
	gate chan struct{}
}

type requestWindow struct {
	period time.Duration
	limit  float64
}

func (l *RequestLimiter) configure(perSecond, perMinute float64) error {
	var windows [2]requestWindow
	for i, rate := range [2]float64{perSecond, perMinute} {
		if math.IsNaN(rate) || math.IsInf(rate, 0) {
			return fmt.Errorf("LLM request rate must be finite")
		}
		if rate <= 0 {
			continue
		}
		period := [2]time.Duration{time.Second, time.Minute}[i]
		// Whole HTTP attempts cannot exceed a fractional window capacity.
		limit := math.Floor(rate)
		if rate < 1 {
			// Preserve fractional rates such as 0.5/s as one attempt per 2s.
			d := math.Ceil(float64(period) / rate)
			if d >= float64(math.MaxInt64) {
				return fmt.Errorf("LLM request rate is too small")
			}
			period, limit = time.Duration(d), 1
		}
		windows[i] = requestWindow{period: period, limit: limit}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.windows = windows
	if l.changed != nil {
		close(l.changed)
	}
	l.changed = make(chan struct{})
	return nil
}

// EnableJitter adds up to 20% (max 250ms) to every positive wait. Production
// wiring turns it on; the zero value keeps exact timings.
func (l *RequestLimiter) EnableJitter() {
	l.mu.Lock()
	l.jitter = true
	l.mu.Unlock()
}

// EnableConcurrency gates in-flight HTTP attempts. The cap is derived from the
// per-second budget (at least 4, at most 32) because a larger in-flight set can
// never be granted slots inside one second; with no rate set it stays unlimited.
func (l *RequestLimiter) EnableConcurrency() {
	l.mu.Lock()
	defer l.mu.Unlock()
	perSecond := 0.0
	for _, w := range l.windows {
		if w.period == time.Second && w.limit > 0 {
			perSecond = w.limit
		}
	}
	if perSecond <= 0 {
		l.gate = nil
		return
	}
	n := int(math.Ceil(perSecond))
	if n < 4 {
		n = 4
	}
	if n > 32 {
		n = 32
	}
	if cap(l.gate) != n {
		l.gate = make(chan struct{}, n)
	}
}

// acquire takes a concurrency slot, returning the channel to hand back.
func (l *RequestLimiter) acquire(ctx context.Context) (chan struct{}, error) {
	l.mu.Lock()
	gate := l.gate
	l.mu.Unlock()
	if gate == nil {
		return nil, ctx.Err()
	}
	select {
	case gate <- struct{}{}:
		return gate, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (l *RequestLimiter) release(gate chan struct{}) {
	if gate != nil {
		<-gate
	}
}

// wait counts a request only when it may actually proceed. Waiters recheck both
// windows under the same lock, so concurrency and cancellation cannot overbook
// capacity. Requests in (now-period, now] count toward each rolling window.
func (l *RequestLimiter) wait(ctx context.Context) error {
	if l == nil {
		return ctx.Err()
	}
	for {
		l.mu.Lock()
		if err := ctx.Err(); err != nil {
			l.mu.Unlock()
			return err
		}
		now := time.Now()
		// Retain at least a minute across limit changes, including while limits
		// are disabled. Fractional rates may need a longer history.
		retention := time.Minute
		for _, w := range l.windows {
			if w.period > retention {
				retention = w.period
			}
		}
		first := 0
		// Keep the last attempt even when older than retention: a subsequent
		// switch to a fractional rate may need to space requests further apart.
		for first+1 < len(l.sent) && !l.sent[first].After(now.Add(-retention)) {
			first++
		}
		l.sent = l.sent[first:]
		var delay time.Duration
		for _, w := range l.windows {
			if w.limit == 0 {
				continue
			}
			start := len(l.sent)
			for start > 0 && l.sent[start-1].After(now.Add(-w.period)) {
				start--
			}
			count := len(l.sent) - start
			if float64(count) >= w.limit {
				// If a limit was lowered, enough old requests must expire to
				// leave room for this attempt, not just the oldest request.
				d := l.sent[len(l.sent)-int(w.limit)].Add(w.period).Sub(now)
				if d > delay {
					delay = d
				}
			}
		}
		if delay <= 0 {
			l.sent = append(l.sent, now)
			l.mu.Unlock()
			return nil
		}
		changed := l.changed
		jitter := l.jitter
		l.mu.Unlock()
		if jitter {
			spread := delay / 5
			if spread > 250*time.Millisecond {
				spread = 250 * time.Millisecond
			}
			if spread > 0 {
				delay += time.Duration(rand.Int64N(int64(spread)))
			}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-changed:
			timer.Stop()
		case <-timer.C:
		}
	}
}

type rateLimitedTransport struct {
	base    http.RoundTripper
	limiter *RequestLimiter
}

func (t rateLimitedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	gate, err := t.limiter.acquire(req.Context())
	if err != nil {
		return nil, err
	}
	defer t.limiter.release(gate)
	if err := t.limiter.wait(req.Context()); err != nil {
		return nil, err
	}
	return t.base.RoundTrip(req)
}
