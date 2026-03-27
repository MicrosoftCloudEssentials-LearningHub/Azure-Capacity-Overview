import { PROVIDERS, createProviderOptionsMarkup } from "./providers.js";

const SETTINGS_KEY = "azure-capacity-overview-settings";
const DEFAULT_REGIONS = ["eastus", "westeurope", "centralus"];

const state = {
  allRecords: [],
  filteredRecords: [],
  lastRefresh: null,
  regionsScanned: 0,
  loading: false,
  dataMode: "overview",
};

const elements = {
  providerOptions: document.querySelector("#provider-options"),
  regionsInput: document.querySelector("#regions-input"),
  refreshButton: document.querySelector("#refresh-button"),
  demoButton: document.querySelector("#demo-button"),
  lastRefresh: document.querySelector("#last-refresh"),
  statusBadge: document.querySelector("#status-badge"),
  summaryCards: document.querySelector("#summary-cards"),
  providerBreakdown: document.querySelector("#provider-breakdown"),
  priorityList: document.querySelector("#priority-list"),
  searchInput: document.querySelector("#search-input"),
  riskFilter: document.querySelector("#risk-filter"),
  providerFilter: document.querySelector("#provider-filter"),
  subscriptionFilter: document.querySelector("#subscription-filter"),
  subscriptionFilterField: document.querySelector("#scope-filter-field"),
  regionFilter: document.querySelector("#region-filter"),
  atRiskToggle: document.querySelector("#at-risk-toggle"),
  tableMeta: document.querySelector("#table-meta"),
  tableBody: document.querySelector("#capacity-table-body"),
  scopeColumnHeader: document.querySelector("#scope-column-header"),
};

bootstrap().catch((error) => {
  console.error(error);
  setStatus(error.message || "Failed to initialize the dashboard.", "bad");
});

async function bootstrap() {
  elements.providerOptions.innerHTML = createProviderOptionsMarkup();
  hydrateSavedSettings();
  wireEvents();
  syncScopeVisibility();
  renderEmptySummary();
  loadDemoData({ source: "overview" });
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", refreshData);
  elements.demoButton.addEventListener("click", () => loadDemoData({ source: "overview" }));

  [
    elements.searchInput,
    elements.riskFilter,
    elements.providerFilter,
    elements.subscriptionFilter,
    elements.regionFilter,
    elements.atRiskToggle,
  ].forEach((element) => {
    element.addEventListener("input", applyFilters);
    element.addEventListener("change", applyFilters);
  });

  [elements.regionsInput, elements.providerOptions].forEach((element) => {
    element.addEventListener("change", persistSettings);
  });
}

function hydrateSavedSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return;
  }

  try {
    const settings = JSON.parse(raw);
    elements.regionsInput.value = settings.regions ?? "";

    if (Array.isArray(settings.providers) && settings.providers.length > 0) {
      for (const checkbox of elements.providerOptions.querySelectorAll('input[type="checkbox"]')) {
        checkbox.checked = settings.providers.includes(checkbox.value);
      }
    }
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

function persistSettings() {
  const settings = {
    regions: elements.regionsInput.value.trim(),
    providers: getSelectedProviderIds(),
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function refreshData() {
  const selectedProviderIds = getSelectedProviderIds();
  const manualRegions = parseList(elements.regionsInput.value).map(normalizeRegion);

  if (selectedProviderIds.length === 0) {
    setStatus("Select at least one availability provider to display.", "warn");
    return;
  }

  persistSettings();
  setLoading(true);
  setStatus("Refreshing Azure availability overview...", "neutral");

  try {
    loadDemoData({
      source: "overview",
      providerIds: selectedProviderIds,
      regions: manualRegions,
    });
  } finally {
    setLoading(false);
  }
}

function loadDemoData(options = {}) {
  const source = options.source || "demo";
  const selectedProviders = new Set(options.providerIds || PROVIDERS.map((provider) => provider.id));
  const regions = options.regions?.length ? options.regions : DEFAULT_REGIONS;
  const overviewScope = "overview";

  const catalog = [
    {
      providerId: "compute-skus",
      providerLabel: "Compute SKUs",
      name: "Standard_D8s_v5",
      resourceType: "virtualMachines",
      metricLabel: "vCPUs",
      metricValue: 8,
      unit: "vCPUs",
      availabilityByRegion: {
        eastus: ["available", "8 vCPUs · 32 GB RAM · 3 zones"],
        westeurope: ["available", "8 vCPUs · 32 GB RAM · 3 zones"],
        centralus: ["available", "8 vCPUs · 32 GB RAM · 3 zones"],
      },
    },
    {
      providerId: "compute-skus",
      providerLabel: "Compute SKUs",
      name: "Standard_NC24ads_A100_v4",
      resourceType: "virtualMachines",
      metricLabel: "GPUs",
      metricValue: 1,
      unit: "GPU",
      availabilityByRegion: {
        eastus: ["available", "A100 available"],
        westeurope: ["available", "A100 available"],
        centralus: ["restricted", "Restricted in this region"],
      },
    },
    {
      providerId: "sql-capabilities",
      providerLabel: "SQL Capabilities",
      name: "BusinessCritical BC_Gen5_16",
      resourceType: "servers/databases",
      metricLabel: "VCores",
      metricValue: 16,
      unit: "VCores",
      availabilityByRegion: {
        eastus: ["available", "BusinessCritical · zone redundant"],
        westeurope: ["available", "BusinessCritical · zone redundant"],
        centralus: ["preview", "Available with staged regional rollout"],
      },
    },
    {
      providerId: "cognitive-skus",
      providerLabel: "Cognitive Services SKUs",
      name: "OpenAI S0",
      resourceType: "accounts",
      metricLabel: "SKU tier",
      metricValue: "Standard",
      unit: "",
      availabilityByRegion: {
        eastus: ["available", "Regional AI offer"],
        westeurope: ["preview", "Regional AI offer in limited rollout"],
        centralus: ["available", "Regional AI offer"],
      },
    },
    {
      providerId: "web-metadata",
      providerLabel: "App Service",
      name: "sites",
      resourceType: "sites",
      metricLabel: "Zones",
      metricValue: 3,
      unit: "zones",
      availabilityByRegion: {
        eastus: ["available", "Supports tags and multi-zone deployment"],
        westeurope: ["available", "Supports tags and multi-zone deployment"],
        centralus: ["available", "Supports tags and multi-zone deployment"],
      },
    },
    {
      providerId: "aks-metadata",
      providerLabel: "AKS",
      name: "managedClusters",
      resourceType: "managedClusters",
      metricLabel: "Zones",
      metricValue: 3,
      unit: "zones",
      availabilityByRegion: {
        eastus: ["available", "Managed clusters regional metadata"],
        westeurope: ["preview", "Managed clusters with staged feature rollout"],
        centralus: ["preview", "Managed clusters with staged feature rollout"],
      },
    },
    {
      providerId: "storage-metadata",
      providerLabel: "Storage",
      name: "storageAccounts",
      resourceType: "storageAccounts",
      metricLabel: "Zones",
      metricValue: 3,
      unit: "zones",
      availabilityByRegion: {
        eastus: ["available", "ZRS-capable regional metadata"],
        westeurope: ["available", "ZRS-capable regional metadata"],
        centralus: ["available", "ZRS-capable regional metadata"],
      },
    },
    {
      providerId: "network-metadata",
      providerLabel: "Network",
      name: "publicIPAddresses",
      resourceType: "publicIPAddresses",
      metricLabel: "API version",
      metricValue: "2024-01-01",
      unit: "",
      availabilityByRegion: {
        eastus: ["available", "Regional network resource metadata"],
        westeurope: ["available", "Regional network resource metadata"],
        centralus: ["available", "Regional network resource metadata"],
      },
    },
  ];

  const demoRows = [];

  for (const item of catalog) {
    if (!selectedProviders.has(item.providerId)) {
      continue;
    }

    for (const region of regions) {
      const regionalSignal = item.availabilityByRegion[region];
      if (!regionalSignal) {
        continue;
      }

      const [availability, notes] = regionalSignal;
      demoRows.push({
        providerId: item.providerId,
        providerLabel: item.providerLabel,
        subscriptionId: overviewScope,
        region,
        name: item.name,
        resourceType: item.resourceType,
        metricLabel: item.metricLabel,
        metricValue: item.metricValue,
        unit: item.unit,
        availability,
        notes,
        sourceType: "overview",
      });
    }
  }

  state.allRecords = demoRows.map(enrichRecord).sort(sortAvailabilityRecords);
  state.dataMode = "overview";
  state.regionsScanned = regions.length;
  state.lastRefresh = new Date();
  elements.lastRefresh.textContent = `${formatDateTime(state.lastRefresh)} ${source}`;

  syncScopeVisibility();
  populateFilterOptions(state.allRecords);
  applyFilters();
  setStatus(
    source === "overview"
      ? "Azure availability overview refreshed. No sign-in or subscription scope is required."
      : "Overview sample data loaded.",
    "good",
  );
}

function enrichRecord(record) {
  const availability = record.availability || "available";

  return {
    ...record,
    availability,
    severity: severityFromAvailability(availability, record.severity),
    searchIndex: [record.providerLabel, record.name, record.resourceType, record.region, record.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function populateFilterOptions(records) {
  setSelectOptions(elements.providerFilter, ["all", ...uniqueValues(records.map((record) => record.providerLabel))], "All providers");
  setSelectOptions(
    elements.subscriptionFilter,
    ["all", ...uniqueValues(records.map((record) => record.subscriptionId))],
    "All scopes",
  );
  setSelectOptions(elements.regionFilter, ["all", ...uniqueValues(records.map((record) => record.region))], "All regions");
}

function applyFilters() {
  const searchTerm = elements.searchInput.value.trim().toLowerCase();
  const availability = elements.riskFilter.value;
  const provider = elements.providerFilter.value;
  const subscription = elements.subscriptionFilter.value;
  const region = elements.regionFilter.value;
  const onlyLimited = elements.atRiskToggle.checked;

  state.filteredRecords = state.allRecords.filter((record) => {
    if (availability !== "all" && record.availability !== availability) {
      return false;
    }

    if (provider !== "all" && record.providerLabel !== provider) {
      return false;
    }

    if (subscription !== "all" && record.subscriptionId !== subscription) {
      return false;
    }

    if (region !== "all" && record.region !== region) {
      return false;
    }

    if (onlyLimited && record.availability === "available") {
      return false;
    }

    if (searchTerm && !record.searchIndex.includes(searchTerm)) {
      return false;
    }

    return true;
  });

  renderSummary(state.filteredRecords, state.allRecords);
  renderPriorityList(state.filteredRecords);
  renderTable(state.filteredRecords);
}

function renderEmptySummary() {
  elements.summaryCards.innerHTML = [
    buildSummaryCard("Tracked offers", "0", "No availability data loaded yet"),
    buildSummaryCard("Available items", "0", "Region-ready offers and SKUs"),
    buildSummaryCard("Limited items", "0", "Restricted or preview items"),
    buildSummaryCard("Regions scanned", "0", "Physical Azure regions"),
  ].join("");
  elements.providerBreakdown.innerHTML = '<p class="empty-state">Provider availability will appear after refresh.</p>';
}

function renderSummary(filteredRecords, allRecords = filteredRecords) {
  const availableCount = filteredRecords.filter((record) => record.availability === "available").length;
  const limitedCount = filteredRecords.filter((record) => record.availability !== "available").length;
  const distinctOffers = new Set(filteredRecords.map((record) => `${record.providerLabel}:${record.name}:${record.region}`)).size;

  elements.summaryCards.innerHTML = [
    buildSummaryCard("Tracked offers", String(distinctOffers), `${allRecords.length} total availability rows`),
    buildSummaryCard("Available items", String(availableCount), "Ready for new deployments"),
    buildSummaryCard("Limited items", String(limitedCount), "Restricted or preview-only items"),
    buildSummaryCard("Regions scanned", String(state.regionsScanned), "Physical Azure regions"),
  ].join("");

  renderProviderBreakdown(filteredRecords);
}

function renderProviderBreakdown(records) {
  if (records.length === 0) {
    elements.providerBreakdown.innerHTML = '<p class="empty-state">No provider data matches the current filters.</p>';
    return;
  }

  const grouped = groupBy(records, (record) => record.providerLabel);
  elements.providerBreakdown.innerHTML = [...grouped.entries()]
    .map(([providerLabel, rows]) => {
      const availableCount = rows.filter((record) => record.availability === "available").length;
      const percent = rows.length ? Math.round((availableCount / rows.length) * 100) : 0;
      return `
        <article class="provider-card">
          <div class="provider-card-header">
            <strong>${escapeHtml(providerLabel)}</strong>
            <span>${percent}% ready</span>
          </div>
          <div class="provider-bar"><span style="width:${Math.min(percent, 100)}%"></span></div>
          <p class="summary-subtext">${rows.length} rows · ${availableCount} available</p>
        </article>
      `;
    })
    .join("");
}

function renderPriorityList(records) {
  const urgentRecords = records
    .filter((record) => record.availability !== "available")
    .sort(sortAvailabilityRecords)
    .slice(0, 6);

  if (urgentRecords.length === 0) {
    elements.priorityList.className = "priority-list empty-state";
    elements.priorityList.textContent = "No restricted or limited offers in the current view.";
    return;
  }

  elements.priorityList.className = "priority-list";
  elements.priorityList.innerHTML = urgentRecords
    .map(
      (record) => `
        <article class="priority-item">
          <div class="priority-topline">
            <strong>${escapeHtml(record.name)}</strong>
            <span class="risk-pill ${record.availability}">${capitalize(record.availability)}</span>
          </div>
          <div class="priority-meta">${escapeHtml(record.providerLabel)} · ${escapeHtml(record.resourceType)} · ${escapeHtml(record.region)}</div>
          <p class="priority-footnote">${escapeHtml(record.notes || `${record.metricLabel}: ${record.metricValue}`)}</p>
        </article>
      `,
    )
    .join("");
}

function renderTable(records) {
  elements.tableMeta.textContent = records.length
    ? `${records.length} rows shown`
    : state.allRecords.length
      ? "No rows match the current filters"
      : "No availability data loaded";

  if (records.length === 0) {
    elements.tableBody.innerHTML = `<tr><td colspan="${getTableColumnCount()}" class="empty-table">${state.allRecords.length ? "Adjust the filters to broaden the view." : "Refresh data or load the overview view to populate the dashboard."}</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = records
    .map(
      (record) => `
        <tr>
          <td><span class="risk-pill ${record.availability}">${capitalize(record.availability)}</span></td>
          <td>${escapeHtml(record.providerLabel)}</td>
          <td>${escapeHtml(record.name)}</td>
          <td>${escapeHtml(record.resourceType)}</td>
          <td>${escapeHtml(record.region)}</td>
          <td>${escapeHtml(record.metricLabel)}</td>
          <td>${escapeHtml(formatMetricValue(record.metricValue, record.unit))}</td>
          <td>${escapeHtml(record.notes || "")}</td>
        </tr>
      `,
    )
    .join("");
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshButton.disabled = isLoading;
  elements.demoButton.disabled = isLoading;
}

function setStatus(message, tone = "neutral") {
  elements.statusBadge.textContent = message;
  elements.statusBadge.className = `status-badge ${tone}`;
}

function syncScopeVisibility() {
  elements.subscriptionFilterField.hidden = true;
  elements.scopeColumnHeader.hidden = true;
  elements.subscriptionFilter.value = "all";
}

function getTableColumnCount() {
  return 8;
}

function getSelectedProviderIds() {
  return [...elements.providerOptions.querySelectorAll('input[type="checkbox"]:checked')].map(
    (checkbox) => checkbox.value,
  );
}

function parseList(rawValue) {
  return rawValue
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function setSelectOptions(select, values, allLabel) {
  const currentValue = select.value;
  select.innerHTML = values
    .map((value, index) => {
      const label = index === 0 ? allLabel : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (values.includes(currentValue)) {
    select.value = currentValue;
  }
}

function buildSummaryCard(label, value, subtext) {
  return `
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong class="summary-value">${escapeHtml(value)}</strong>
      <div class="summary-subtext">${escapeHtml(subtext)}</div>
    </article>
  `;
}

function groupBy(items, keySelector) {
  const map = new Map();
  for (const item of items) {
    const key = keySelector(item);
    const bucket = map.get(key) || [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

function uniqueValues(items) {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }
  return unit ? `${value} ${unit}` : String(value);
}

function normalizeRegion(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function severityFromAvailability(availability, existingSeverity = 1) {
  if (typeof existingSeverity === "number") {
    return existingSeverity;
  }
  if (availability === "restricted") {
    return 3;
  }
  if (availability === "preview") {
    return 2;
  }
  return 1;
}

function sortAvailabilityRecords(left, right) {
  return (
    right.severity - left.severity ||
    left.providerLabel.localeCompare(right.providerLabel) ||
    left.name.localeCompare(right.name) ||
    left.region.localeCompare(right.region)
  );
}