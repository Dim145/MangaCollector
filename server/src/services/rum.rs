//! 測 · Field measurements — the Core Web Vitals readers' browsers report,
//! when the operator turns it on (`RUM_ENABLED`).
//!
//! A self-hosted instance has no Chrome UX Report: nobody but its own
//! readers ever loads it, so the only numbers about how fast it is for
//! them are the ones their browsers measure. The SPA sends them in a
//! beacon when a page is hidden (`client/src/lib/rum.js`); this module
//! decides what of a beacon to believe, and keeps a small summary in
//! memory: the last `RESERVOIR` values per page and metric, from which
//! `summary` answers p50 / p75 / p95.
//!
//! Nothing here names a reader. A beacon carries a page (`/author/:id`,
//! never an id), a metric, its value, and for the slow ones the CSS
//! selector of the element at fault — the handler logs each accepted
//! value under the `mc_rum` target and that is all that is kept.
//! Everything else in a beacon is dropped, and a beacon that is wrong
//! in any way loses its wrong parts rather than being answered with an
//! error a script could probe.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Values kept per page and metric — enough for a p95 to mean something,
/// small enough that the whole store stays under a megabyte.
pub const RESERVOIR: usize = 512;
/// Distinct (page, metric) pairs kept. Pages are normalised by the
/// client, so a real instance has a few dozen; the cap is for a client
/// that is not ours.
pub const MAX_SERIES: usize = 256;
/// Metrics believed per beacon.
pub const MAX_METRICS: usize = 12;

const METRICS: [&str; 5] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

/// A beacon as the SPA sends it. Every field is optional or bounded in
/// `accept`; unknown fields are ignored.
#[derive(Debug, Deserialize)]
pub struct Beacon {
    #[serde(default)]
    pub app: Option<String>,
    #[serde(default)]
    pub device: Option<Device>,
    #[serde(default)]
    pub metrics: Vec<RawMetric>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Device {
    #[serde(default)]
    pub mobile: Option<bool>,
    #[serde(default)]
    pub conn: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawMetric {
    pub n: String,
    pub v: f64,
    #[serde(default)]
    pub r: Option<String>,
    #[serde(default)]
    pub nav: Option<String>,
    pub route: String,
    /// Selector of the element at fault (LCP element, INP target, CLS).
    #[serde(default)]
    pub t: Option<String>,
    /// INP: `pointer` or `keyboard`.
    #[serde(default)]
    pub k: Option<String>,
    /// Phases, in the metric's own order (LCP: TTFB, load delay, load
    /// time, render delay; INP: input delay, processing, presentation).
    #[serde(default)]
    pub d: Vec<f64>,
}

/// A metric this server believes, ready to log and to count.
#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    pub metric: &'static str,
    pub value: f64,
    pub rating: Option<&'static str>,
    pub navigation: Option<String>,
    pub route: String,
    pub target: Option<String>,
    pub input: Option<&'static str>,
    pub phases: Vec<f64>,
}

/// The beacon's context, as far as it is believable.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Context {
    pub app: Option<String>,
    pub mobile: Option<bool>,
    pub connection: Option<&'static str>,
}

/// What of a beacon to believe.
pub fn accept(beacon: Beacon) -> (Context, Vec<Sample>) {
    let context = Context {
        app: beacon.app.filter(|a| {
            !a.is_empty()
                && a.len() <= 32
                && a.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
        }),
        mobile: beacon.device.as_ref().and_then(|d| d.mobile),
        connection: beacon
            .device
            .as_ref()
            .and_then(|d| d.conn.as_deref())
            .and_then(|c| ["slow-2g", "2g", "3g", "4g"].into_iter().find(|k| *k == c)),
    };
    let samples = beacon
        .metrics
        .into_iter()
        .take(MAX_METRICS)
        .filter_map(accept_metric)
        .collect();
    (context, samples)
}

fn accept_metric(raw: RawMetric) -> Option<Sample> {
    let metric = METRICS.into_iter().find(|m| *m == raw.n)?;
    let ceiling = if metric == "CLS" { 50.0 } else { 600_000.0 };
    if !raw.v.is_finite() || raw.v < 0.0 || raw.v > ceiling {
        return None;
    }
    if !route_is_plausible(&raw.route) {
        return None;
    }
    Some(Sample {
        metric,
        value: raw.v,
        rating: raw.r.as_deref().and_then(|r| {
            ["good", "needs-improvement", "poor"]
                .into_iter()
                .find(|k| *k == r)
        }),
        navigation: raw
            .nav
            .filter(|n| n.len() <= 24 && n.chars().all(|c| c.is_ascii_lowercase() || c == '-')),
        route: raw.route,
        target: raw.t.map(|t| clean_selector(&t)).filter(|t| !t.is_empty()),
        input: raw
            .k
            .as_deref()
            .and_then(|k| ["pointer", "keyboard"].into_iter().find(|i| *i == k)),
        phases: raw
            .d
            .into_iter()
            .take(4)
            .filter(|p| p.is_finite())
            .map(|p| p.clamp(0.0, 600_000.0))
            .collect(),
    })
}

/// A page as the client names it: `/stats`, `/author/:id`. Never a
/// query, never a value — the client replaced those with a placeholder.
pub fn route_is_plausible(route: &str) -> bool {
    route.starts_with('/')
        && route.len() <= 64
        && route
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/_:.-".contains(c))
}

/// A CSS selector for a log line: no control characters, no quotes that
/// would break a log parser, at most 120 characters.
fn clean_selector(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .take(120)
        .collect::<String>()
        .trim()
        .to_string()
}

/// One row of the summary.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SummaryRow {
    pub route: String,
    pub metric: &'static str,
    pub count: usize,
    pub p50: f64,
    pub p75: f64,
    pub p95: f64,
}

/// The last values per (page, metric), since the server started.
#[derive(Default)]
pub struct RumStore {
    series: Mutex<HashMap<(String, &'static str), VecDeque<f64>>>,
}

impl RumStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, sample: &Sample) {
        let Ok(mut series) = self.series.lock() else {
            return;
        };
        let key = (sample.route.clone(), sample.metric);
        if !series.contains_key(&key) && series.len() >= MAX_SERIES {
            return;
        }
        let values = series.entry(key).or_default();
        if values.len() == RESERVOIR {
            values.pop_front();
        }
        values.push_back(sample.value);
    }

    pub fn summary(&self) -> Vec<SummaryRow> {
        let Ok(series) = self.series.lock() else {
            return Vec::new();
        };
        let mut rows: Vec<SummaryRow> = series
            .iter()
            .map(|((route, metric), values)| {
                let mut sorted: Vec<f64> = values.iter().copied().collect();
                sorted.sort_by(f64::total_cmp);
                SummaryRow {
                    route: route.clone(),
                    metric,
                    count: sorted.len(),
                    p50: percentile(&sorted, 0.50),
                    p75: percentile(&sorted, 0.75),
                    p95: percentile(&sorted, 0.95),
                }
            })
            .collect();
        rows.sort_by(|a, b| a.route.cmp(&b.route).then(a.metric.cmp(b.metric)));
        rows
    }
}

/// Nearest-rank percentile of sorted values; 0 for none. Rounded to a
/// tenth for times and to a thousandth for CLS by the caller's display —
/// here it is the value as measured.
pub fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (q * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metric(n: &str, v: f64, route: &str) -> RawMetric {
        RawMetric {
            n: n.into(),
            v,
            r: Some("good".into()),
            nav: Some("navigate".into()),
            route: route.into(),
            t: None,
            k: None,
            d: vec![],
        }
    }

    fn beacon(metrics: Vec<RawMetric>) -> Beacon {
        Beacon {
            app: Some("2.16.3".into()),
            device: Some(Device {
                mobile: Some(true),
                conn: Some("4g".into()),
            }),
            metrics,
        }
    }

    #[test]
    fn believes_the_five_metrics_and_nothing_else() {
        let (_, samples) = accept(beacon(vec![
            metric("LCP", 2400.0, "/stats"),
            metric("INP", 120.0, "/dashboard"),
            metric("CLS", 0.02, "/stats"),
            metric("FCP", 900.0, "/"),
            metric("TTFB", 80.0, "/"),
            metric("FID", 10.0, "/"),
            metric("lcp", 10.0, "/"),
        ]));
        let names: Vec<_> = samples.iter().map(|s| s.metric).collect();
        assert_eq!(names, ["LCP", "INP", "CLS", "FCP", "TTFB"]);
    }

    #[test]
    fn drops_a_value_no_browser_measures() {
        let (_, samples) = accept(beacon(vec![
            metric("LCP", -1.0, "/stats"),
            metric("LCP", f64::NAN, "/stats"),
            metric("LCP", f64::INFINITY, "/stats"),
            metric("LCP", 700_000.0, "/stats"),
            metric("CLS", 51.0, "/stats"),
            metric("CLS", 0.5, "/stats"),
        ]));
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].value, 0.5);
    }

    #[test]
    fn takes_a_page_but_never_a_query_or_free_text() {
        assert!(route_is_plausible("/author/:id"));
        assert!(route_is_plausible("/year-in-review/:year/:month"));
        assert!(!route_is_plausible("stats"));
        assert!(!route_is_plausible("/mangapage?mal_id=13"));
        assert!(!route_is_plausible("/u/someone@example.com"));
        assert!(!route_is_plausible("/a b"));
        assert!(!route_is_plausible(&format!("/{}", "a".repeat(64))));
    }

    #[test]
    fn keeps_only_known_words_in_the_context_and_the_details() {
        let mut raw = metric("INP", 300.0, "/dashboard");
        raw.r = Some("terrible".into());
        raw.nav = Some("<script>".into());
        raw.k = Some("voice".into());
        raw.t = Some("button.\"x\"\u{7}".repeat(30));
        raw.d = vec![10.0, f64::NAN, -5.0, 1e9, 3.0, 4.0];
        let mut b = beacon(vec![raw]);
        b.app = Some("2.16.3; rm -rf".into());
        b.device = Some(Device {
            mobile: Some(false),
            conn: Some("5g".into()),
        });
        let (context, samples) = accept(b);
        assert_eq!(context.app, None);
        assert_eq!(context.connection, None);
        assert_eq!(context.mobile, Some(false));
        let s = &samples[0];
        assert_eq!(s.rating, None);
        assert_eq!(s.navigation, None);
        assert_eq!(s.input, None);
        let target = s.target.as_deref().unwrap();
        assert!(
            target.len() <= 120 && !target.contains('"') && !target.chars().any(char::is_control)
        );
        assert_eq!(s.phases, vec![10.0, 0.0, 600_000.0]);
    }

    #[test]
    fn believes_at_most_a_dozen_metrics_a_beacon() {
        let (_, samples) = accept(beacon((0..40).map(|_| metric("LCP", 1.0, "/")).collect()));
        assert_eq!(samples.len(), MAX_METRICS);
    }

    #[test]
    fn summarises_the_last_values_per_page_and_metric() {
        let store = RumStore::new();
        for v in 1..=100 {
            let (_, samples) = accept(beacon(vec![metric("LCP", f64::from(v), "/stats")]));
            store.record(&samples[0]);
        }
        let (_, samples) = accept(beacon(vec![metric("INP", 40.0, "/stats")]));
        store.record(&samples[0]);
        let rows = store.summary();
        assert_eq!(rows.len(), 2);
        let lcp = rows.iter().find(|r| r.metric == "LCP").unwrap();
        assert_eq!(
            (lcp.count, lcp.p50, lcp.p75, lcp.p95),
            (100, 50.0, 75.0, 95.0)
        );
        assert_eq!(rows.iter().find(|r| r.metric == "INP").unwrap().p75, 40.0);
    }

    #[test]
    fn forgets_the_oldest_values_and_caps_the_pages() {
        let store = RumStore::new();
        for v in 0..(RESERVOIR + 10) {
            let (_, s) = accept(beacon(vec![metric("TTFB", v as f64, "/")]));
            store.record(&s[0]);
        }
        let row = &store.summary()[0];
        assert_eq!(row.count, RESERVOIR);
        assert_eq!(percentile(&[1.0], 0.95), 1.0);
        for i in 0..(MAX_SERIES + 20) {
            let (_, s) = accept(beacon(vec![metric("FCP", 1.0, &format!("/p{i}"))]));
            store.record(&s[0]);
        }
        assert_eq!(store.summary().len(), MAX_SERIES);
    }
}
