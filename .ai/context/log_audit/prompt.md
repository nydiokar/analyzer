You are an expert in production logging architecture and observability design.

I will give you:
- A structured LOG MAP extracted via AST that contains:
  - Component (file/module)
  - Log message
  - Log level
  - Line number
  - Description

This map represents the CURRENT STATE of a real logging system.

Your job is to:

1) AUDIT THE LOGGING SYSTEM AT A SYSTEM LEVEL
   - Identify:
     - Over-logging at INFO
     - Debug noise that belongs in TRACE or should be removed
     - Misclassified WARN vs ERROR
     - Silent failure zones (missing logs where they should exist)
   - Detect:
     - Components that are too chatty
     - Components that are too quiet
     - Components where lifecycle boundaries are unclear

2) ENFORCE THE TARGET LOG LEVEL MODEL
   Use these hard definitions:

   ERROR:
   - User-visible failure, data corruption risk, broken invariants, aborted critical flows.

   WARN:
   - Degraded behavior, fallbacks, suspicious but survivable states.

   INFO:
   - High-level lifecycle + business state transitions ONLY.
   - From INFO alone, a human must be able to answer:
     - What jobs/requests ran?
     - Did they succeed or fail?
     - Rough duration?
     - What entities changed?

   DEBUG:
   - Internal decisions, filtering, retries, computed intermediates.

   TRACE:
   - Per-iteration, per-object, hyper-verbose mechanics.

3) FOR EACH COMPONENT IN THE MAP:
   - Classify it as:
     - ✅ Healthy
     - ⚠️ Noisy
     - ❌ Under-instrumented
   - Provide:
     - Ideal INFO surface for that component
     - What percentage of its current INFO should be downgraded
     - Whether it leaks implementation detail into INFO

4) FOR EACH LOG STATEMENT (OR CLUSTER OF SIMILAR ONES):
   - Output:
     - Current Level
     - Recommended Level
     - Rewrite of the message (if needed)
     - Whether it should include:
       - requestId
       - walletId
       - jobId
       - runId
       - component
     - Reason for change

5) STRUCTURAL VIOLATIONS TO DETECT:
   - INFO logs that are really:
     - Loop iteration logs
     - Filtering mechanics
     - Retry mechanics
   - ERROR logs that:
     - Do not include actionable identifiers
     - Do not identify the failed operation
   - WARN logs that are actually:
     - Guaranteed failures (should be ERROR)
     - Or normal conditions (should be INFO)

6) LIFECYCLE COMPLETENESS CHECK
   For each major workflow (sync, analysis, report, fetch, bot command):
   - Verify that it has:
     - A clear START INFO log
     - Optional MIDDLE INFO milestones
     - A clear END INFO log
     - ERROR logs on failure boundaries
   - If not, specify exactly where logs are missing.

7) DISPLAY/OUTPUT SEPARATION RULE
   - Detect any logs that are actually:
     - CLI user output
     - Reports
     - Formatting
   - These must NOT be treated as observability logs.
   - They must be labeled as:
     - “Output stream”
     - NOT “Logging stream”

8) FINAL OUTPUT FORMAT
   You must return:

   A) SYSTEM-LEVEL ASSESSMENT
      - Overall noise health
      - INFO surface quality
      - ERROR/WARN maturity
      - Observability gaps

   B) COMPONENT SCORECARD
      For each component:
      - Noise level: Low / Medium / High
      - Observability quality: Weak / Adequate / Strong
      - Refactor priority: Low / Medium / High

   C) REWRITE RULESET
      - Universal conventions to impose after refactor
      - Message grammar rules
      - Field schema rules

   D) OPTIONAL SAMPLE BEFORE/AFTER
      - Pick 1–2 noisy components
      - Show a compact before (current pattern)
      - Show a clean after (ideal pattern)

IMPORTANT:
- Do NOT treat the map as hypothetical. It is real production code.
- Do NOT optimize for verbosity.
- Optimize for:
  - Human scanning
  - Incident forensics
  - Lifecycle reconstruction
  - Minimal but sufficient signal

Now analyze the provided LOG MAP and produce the full audit.