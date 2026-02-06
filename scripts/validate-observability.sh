#!/bin/bash
# Observability Stack Validation Script
# Run this after setup to verify everything works

set -e

echo "========================================"
echo "Observability Stack Validation"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

check_endpoint() {
    local name=$1
    local url=$2
    local grep_pattern=$3

    echo -n "Checking $name... "

    if curl -s --connect-timeout 5 "$url" | grep -q "$grep_pattern"; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        echo "  URL: $url"
        echo "  Expected pattern: $grep_pattern"
        ((FAILED++))
        return 1
    fi
}

echo "Phase 1: Application Metrics"
echo "----------------------------"
check_endpoint "App metrics endpoint" "http://localhost:3001/api/v1/metrics" "# HELP"
check_endpoint "HTTP request counter" "http://localhost:3001/api/v1/metrics" "http_requests_total"
check_endpoint "HTTP duration histogram" "http://localhost:3001/api/v1/metrics" "http_request_duration_seconds"
check_endpoint "Analysis jobs counter" "http://localhost:3001/api/v1/metrics" "analysis_jobs_total"
check_endpoint "Analysis job duration" "http://localhost:3001/api/v1/metrics" "analysis_job_duration_seconds"
check_endpoint "BullMQ waiting gauge" "http://localhost:3001/api/v1/metrics" "bullmq_jobs_waiting"
check_endpoint "BullMQ active gauge" "http://localhost:3001/api/v1/metrics" "bullmq_jobs_active"
check_endpoint "BullMQ failed gauge" "http://localhost:3001/api/v1/metrics" "bullmq_jobs_failed"
check_endpoint "Node.js heap metric" "http://localhost:3001/api/v1/metrics" "nodejs_memory_usage_bytes"
echo ""

echo "Phase 2: Exporters"
echo "------------------"
check_endpoint "Node Exporter" "http://localhost:9100/metrics" "node_cpu_seconds_total" || echo -e "  ${YELLOW}Install: sudo apt install prometheus-node-exporter${NC}"
check_endpoint "Postgres Exporter" "http://localhost:9187/metrics" "pg_stat_database" || echo -e "  ${YELLOW}See: docs/observability/EXPORTER_INSTALLATION.md${NC}"
check_endpoint "Redis Exporter" "http://localhost:9121/metrics" "redis_memory_used_bytes" || echo -e "  ${YELLOW}See: docs/observability/EXPORTER_INSTALLATION.md${NC}"
echo ""

echo "Phase 3: Prometheus"
echo "-------------------"
check_endpoint "Prometheus UI" "http://localhost:9090" "Prometheus" || echo -e "  ${YELLOW}Install: sudo apt install prometheus${NC}"
check_endpoint "Prometheus API" "http://localhost:9090/api/v1/targets" "\"health\":\"up\"" || echo -e "  ${YELLOW}Check: http://localhost:9090/targets${NC}"
echo ""

echo "Phase 4: Grafana"
echo "----------------"
check_endpoint "Grafana UI" "http://localhost:3000" "Grafana" || echo -e "  ${YELLOW}Install: sudo apt install grafana${NC}"
echo ""

echo "========================================"
echo "Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Observability stack is ready.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Import Grafana dashboards: see docs/observability/dashboards/README.md"
    echo "2. Set up alerts: see docs/observability/README.md"
    echo "3. Access dashboards: http://localhost:3000"
    exit 0
else
    echo -e "${YELLOW}⚠ Some checks failed. See messages above for installation instructions.${NC}"
    echo ""
    echo "Quick fixes:"
    echo "- App metrics: Ensure your app is running on port 3001"
    echo "- Exporters: Follow docs/observability/EXPORTER_INSTALLATION.md"
    echo "- Prometheus: Follow docs/observability/PROMETHEUS_SETUP.md"
    echo "- Grafana: sudo apt install grafana && sudo systemctl start grafana-server"
    exit 1
fi
