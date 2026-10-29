use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct TokenBucketLimiter {
    bytes_per_second: AtomicI64,
    state: Mutex<LimiterState>,
}

struct LimiterState {
    available_tokens: f64,
    last_refill: Instant,
}

impl TokenBucketLimiter {
    pub fn new(bytes_per_second: i64) -> Self {
        let initial_tokens = bytes_per_second.max(0) as f64;
        Self {
            bytes_per_second: AtomicI64::new(bytes_per_second),
            state: Mutex::new(LimiterState {
                available_tokens: initial_tokens,
                last_refill: Instant::now(),
            }),
        }
    }

    pub fn set_rate(&self, bytes_per_second: i64) {
        let mut state = self.state.lock().unwrap();
        self.bytes_per_second
            .store(bytes_per_second, Ordering::Relaxed);
        let now = Instant::now();
        state.last_refill = now;
        if bytes_per_second <= 0 {
            state.available_tokens = 0.0;
        } else {
            let max_burst = (bytes_per_second as f64).max(65536.0);
            state.available_tokens = state.available_tokens.clamp(0.0, max_burst);
        }
    }

    #[inline]
    #[allow(dead_code)]
    pub fn rate(&self) -> i64 {
        self.bytes_per_second.load(Ordering::Relaxed)
    }

    #[allow(dead_code)]
    pub async fn consume(&self, byte_count: usize) {
        self.consume_with_cancel(byte_count, None).await;
    }

    pub async fn consume_with_cancel(&self, byte_count: usize, cancel_flag: Option<&AtomicBool>) {
        let rate = self.bytes_per_second.load(Ordering::Relaxed);
        if rate <= 0 || byte_count == 0 {
            return;
        }

        let needed_delay = {
            let mut state = self.state.lock().unwrap();
            let rate = self.bytes_per_second.load(Ordering::Relaxed);
            if rate <= 0 {
                return;
            }

            let rate_f = rate as f64;
            let now = Instant::now();
            let elapsed = now.duration_since(state.last_refill).as_secs_f64();
            state.last_refill = now;

            // Maximum burst capacity: 1 second worth of bandwidth or 64 KB, whichever is larger
            let max_burst = rate_f.max(65536.0);
            state.available_tokens = (state.available_tokens + elapsed * rate_f).min(max_burst);

            // Deduct requested bytes (debts go negative to accurately synchronize multiple concurrent workers)
            state.available_tokens -= byte_count as f64;

            if state.available_tokens >= 0.0 {
                None
            } else {
                let debt = -state.available_tokens;
                let max_debt = rate_f * 2.0;
                if debt > max_debt {
                    state.available_tokens = -max_debt;
                }
                Some(Duration::from_secs_f64(debt.min(max_debt) / rate_f))
            }
        };

        if let Some(total_delay) = needed_delay {
            let deadline = tokio::time::Instant::now() + total_delay;
            while tokio::time::Instant::now() < deadline {
                if let Some(flag) = cancel_flag {
                    if flag.load(Ordering::Relaxed) {
                        break;
                    }
                }
                if self.bytes_per_second.load(Ordering::Relaxed) <= 0 {
                    break;
                }
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                let slice = remaining.min(Duration::from_millis(50));
                tokio::time::sleep(slice).await;
            }
        }
    }
}
