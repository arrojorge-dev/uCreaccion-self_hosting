// Smoke de carga ligero: /health/live + GET /tasks (auth + DB + rate-limit).
// Uso:
//   docker run --rm --network host -v "$PWD/tests/k6:/scripts" \
//     -e BASE_URL=http://127.0.0.1:5000 grafana/k6 run /scripts/smoke.js
// Objetivos p99: p(95)<500ms, p(99)<1000ms, error rate < 1%.
import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:5000";
const failures = new Rate("failed_requests");

export const options = {
    vus: 5,
    duration: "30s",
    thresholds: {
        http_req_duration: ["p(95)<500", "p(99)<1000"],
        failed_requests: ["rate<0.01"],
    },
};

export function setup() {
    const nickname = `k6-${Date.now()}-${__VU}@test.dev`;
    const register = http.post(
        `${BASE_URL}/api/v1/auth/register`,
        JSON.stringify({ nickname, password: "password-123" }),
        { headers: { "content-type": "application/json" } },
    );
    const body = register.json();
    return { token: body.tokens?.accessToken };
}

export default function (data) {
    const auth = { headers: { authorization: `Bearer ${data.token}` } };

    const health = http.get(`${BASE_URL}/health/live`);
    check(health, { "health/live returns 200": (r) => r.status === 200 });
    failures.add(health.status !== 200);

    const tasks = http.get(`${BASE_URL}/api/v1/tasks`, auth);
    check(tasks, { "tasks returns 200": (r) => r.status === 200 });
    failures.add(tasks.status !== 200);
}
