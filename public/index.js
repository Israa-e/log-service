let errorChart = null;

async function loadStats() {
  const res = await fetch("/logs?limit=1000");
  const data = await res.json();

  document.getElementById("stat-total").textContent = data.logs.length + "+";

  const services = new Set(data.logs.map((l) => l.service));
  document.getElementById("stat-services").textContent = services.size;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const errRes = await fetch(
    `/logs/aggregate?since=${oneHourAgo}&until=${new Date().toISOString()}&bucket=1h&level=error`
  );
  const errData = await errRes.json();
  const errorCount = errData.buckets.reduce((sum, b) => sum + b.count, 0);
  document.getElementById("stat-error-rate").textContent = errorCount;

  const serviceSelect = document.getElementById("filter-service");
  const currentValue = serviceSelect.value;
  serviceSelect.innerHTML = '<option value="">All Services</option>';
  services.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    serviceSelect.appendChild(opt);
  });
  serviceSelect.value = currentValue;
}

let currentLogs = [];

async function loadLogs() {
  const service = document.getElementById("filter-service").value;
  const level = document.getElementById("filter-level").value;
  const q = document.getElementById("filter-q").value;

  const params = new URLSearchParams({ limit: "50" });
  if (service) params.set("service", service);
  if (level) params.set("level", level);
  if (q) params.set("q", q);

  const res = await fetch(`/logs?${params.toString()}`);
  const data = await res.json();
  currentLogs = data.logs;

  const tbody = document.getElementById("logs-body");
  tbody.innerHTML = "";

  if (data.logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No logs found</td></tr>';
    return;
  }

  data.logs.forEach((log, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td><span class="badge badge-${log.level}">${log.level}</span></td>
      <td>${log.service}</td>
      <td>${log.message}</td>
    `;
    row.addEventListener("click", () => openDrawer(index));
    tbody.appendChild(row);
  });
}

function openDrawer(index) {
  const log = currentLogs[index];
  const content = document.getElementById("drawer-content");

  content.innerHTML = `
    <div class="drawer-field">
      <div class="drawer-label">Timestamp</div>
      <div class="drawer-value">${new Date(log.timestamp).toLocaleString()}</div>
    </div>
    <div class="drawer-field">
      <div class="drawer-label">Level</div>
      <div class="drawer-value"><span class="badge badge-${log.level}">${log.level}</span></div>
    </div>
    <div class="drawer-field">
      <div class="drawer-label">Service</div>
      <div class="drawer-value">${log.service}</div>
    </div>
    <div class="drawer-field">
      <div class="drawer-label">Message</div>
      <div class="drawer-value">${log.message}</div>
    </div>
    <div class="drawer-field">
      <div class="drawer-label">Attributes</div>
      <div class="drawer-json">${
        log.attributes ? JSON.stringify(log.attributes, null, 2) : "null"
      }</div>
    </div>
  `;

  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("open");
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("open");
}

async function loadChart() {
  const until = new Date().toISOString();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(
    `/logs/aggregate?since=${since}&until=${until}&bucket=1h&level=error`
  );
  const data = await res.json();

  const labels = data.buckets.map((b) =>
    new Date(b.start).toLocaleTimeString([], { hour: "2-digit" })
  );
  const counts = data.buckets.map((b) => b.count);

  const ctx = document.getElementById("errorChart").getContext("2d");

  if (errorChart) {
    errorChart.data.labels = labels;
    errorChart.data.datasets[0].data = counts;
    errorChart.update();
    return;
  }

  errorChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Errors",
          data: counts,
          borderColor: "#EF4444",
          backgroundColor: "rgba(239,68,68,0.15)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" }, beginAtZero: true },
      },
    },
  });
}
function switchView(viewName) {
  document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
  document.getElementById(`view-${viewName}`).style.display = "block";

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.querySelector(`[data-view="${viewName}"]`).classList.add("active");

  if (viewName === "settings") loadAlertRules();
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    switchView(item.dataset.view);
  });
});

async function loadAlertRules() {
  const res = await fetch("/alerts/list");
  const rules = await res.json();

  const tbody = document.getElementById("alerts-body");
  tbody.innerHTML = "";

  if (rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No rules yet</td></tr>';
    return;
  }

  rules.forEach((rule) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${rule.service || "All"}</td>
      <td>${rule.threshold}</td>
      <td>${rule.window_minutes}m</td>
      <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${rule.webhook_url}</td>
    `;
    tbody.appendChild(row);
  });
}

async function createAlertRule() {
  const service = document.getElementById("alert-service").value;
  const threshold = parseInt(document.getElementById("alert-threshold").value, 10);
  const window_minutes = parseInt(document.getElementById("alert-window").value, 10);
  const webhook_url = document.getElementById("alert-webhook").value;

  const res = await fetch("/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: service || undefined, threshold, window_minutes, webhook_url }),
  });

  if (res.ok) {
    document.getElementById("alert-service").value = "";
    document.getElementById("alert-threshold").value = "";
    document.getElementById("alert-window").value = "";
    document.getElementById("alert-webhook").value = "";
    loadAlertRules();
  } else {
    const err = await res.json();
    alert("Error: " + err.error);
  }
}
async function addLog() {
  const level = document.getElementById("new-log-level").value;
  const service = document.getElementById("new-log-service").value.trim();
  const message = document.getElementById("new-log-message").value.trim();

  if (!service || !message) {
    alert("Please fill in service and message");
    return;
  }

  const res = await fetch("/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      logs: [
        {
          timestamp: new Date().toISOString(),
          level,
          service,
          message,
        },
      ],
    }),
  });

  const data = await res.json();

  if (data.accepted > 0) {
    document.getElementById("new-log-service").value = "";
    document.getElementById("new-log-message").value = "";
    loadLogs();
  } else {
    alert("Rejected: " + JSON.stringify(data.rejected));
  }
}
function changeTheme(theme) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("dashboard-theme", theme);
}

const savedTheme = localStorage.getItem("dashboard-theme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
  document.getElementById("theme-select").value = savedTheme;
}



loadStats();
loadLogs();
loadChart();
setInterval(loadStats, 10000);
setInterval(loadLogs, 5000);
setInterval(loadChart, 10000);