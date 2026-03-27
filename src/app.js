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
  sort: {
    key: "availability",
    direction: "desc",
  },
};

const elements = {
  pageBody: document.body,
  providerOptions: document.querySelector("#provider-options"),
  regionsInput: document.querySelector("#regions-input"),
  refreshButton: document.querySelector("#refresh-button"),
  demoButton: document.querySelector("#demo-button"),
  themeToggleButton: document.querySelector("#theme-toggle"),
  lastRefresh: document.querySelector("#last-refresh"),
  statusBadge: document.querySelector("#status-badge"),
  updatesMeta: document.querySelector("#updates-meta"),
  updatesTableBody: document.querySelector("#updates-table-body"),
  searchInput: document.querySelector("#search-input"),
  riskFilter: document.querySelector("#risk-filter"),
  planningFilter: document.querySelector("#planning-filter"),
  providerFilter: document.querySelector("#provider-filter"),
  subscriptionFilter: document.querySelector("#subscription-filter"),
  subscriptionFilterField: document.querySelector("#scope-filter-field"),
  regionFilter: document.querySelector("#region-filter"),
  atRiskToggle: document.querySelector("#at-risk-toggle"),
  tableMeta: document.querySelector("#table-meta"),
  tableBody: document.querySelector("#capacity-table-body"),
  tableHead: document.querySelector("thead"),
  scopeColumnHeader: document.querySelector("#scope-column-header"),
  filterChips: document.querySelector("#filter-chips"),
};

async function bootstrap() {
  applyTheme("light");
  elements.providerOptions.innerHTML = createProviderOptionsMarkup();
  hydrateSavedSettings();
  wireEvents();
  syncScopeVisibility();
  renderEmptyUpdatesTable();
  loadDemoData({ source: "overview" });
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", refreshData);
  elements.demoButton.addEventListener("click", () => loadDemoData({ source: "overview" }));
  elements.themeToggleButton.addEventListener("click", toggleTheme);
  elements.tableBody.addEventListener("click", handleSourceActionClick);
  elements.updatesTableBody.addEventListener("click", handleSourceActionClick);
  elements.tableHead.addEventListener("click", handleTableSortClick);
  elements.filterChips.addEventListener("click", handleChipClick);

  [
    elements.searchInput,
    elements.riskFilter,
    elements.planningFilter,
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
    applyTheme(settings.theme || "light");
    elements.planningFilter.value = settings.planning || "all";

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
    theme: getCurrentTheme(),
    planning: elements.planningFilter.value,
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setTheme(theme) {
  applyTheme(theme);
  persistSettings();
}

function toggleTheme() {
  setTheme(getCurrentTheme() === "dark" ? "light" : "dark");
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  elements.pageBody.dataset.theme = normalizedTheme;
  elements.themeToggleButton.textContent = normalizedTheme === "dark" ? "☀️" : "🌙";
  elements.themeToggleButton.setAttribute(
    "aria-label",
    normalizedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
  elements.themeToggleButton.setAttribute(
    "title",
    normalizedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

function getCurrentTheme() {
  return elements.pageBody.dataset.theme || "light";
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
  const searchContent = [
    record.providerLabel,
    record.name,
    record.resourceType,
    record.region,
    getRegionDisplayName(record.region),
    getSourceProductName(record),
    getPlanningSignalLabel({ ...record, availability }),
    record.notes,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...record,
    availability,
    severity: severityFromAvailability(availability, record.severity),
    sourceUrl: getSourceUrl(record),
    sourceLabel: getSourceLabel(record),
    sourceTitle: getSourceTitle(record),
    searchIndex: searchContent.toLowerCase(),
    searchNeedle: normalizeSearchValue(searchContent),
    searchCompact: compactSearchValue(searchContent),
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
  const rawSearchTerm = elements.searchInput.value.trim();
  const searchTerm = rawSearchTerm.toLowerCase();
  const availability = elements.riskFilter.value;
  const planning = elements.planningFilter.value;
  const provider = elements.providerFilter.value;
  const subscription = elements.subscriptionFilter.value;
  const region = elements.regionFilter.value;
  const onlyLimited = elements.atRiskToggle.checked;

  state.filteredRecords = state.allRecords.filter((record) => {
    if (availability !== "all" && record.availability !== availability) {
      return false;
    }

    if (planning === "available-now" && record.availability !== "available") {
      return false;
    }

    if (planning === "roadmap" && record.availability !== "preview") {
      return false;
    }

    if (planning === "constraints" && record.availability !== "restricted") {
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

    if (searchTerm && !matchesSearch(record, searchTerm)) {
      return false;
    }

    return true;
  });

  renderUpdatesTable(state.filteredRecords, rawSearchTerm);
  renderTable(state.filteredRecords, rawSearchTerm);
  renderFilterChips();
}

function renderFilterChips() {
  const chips = [];

  const searchTerms = elements.searchInput.value.trim().split(/\s+/).filter(Boolean);
  for (const term of searchTerms) {
    chips.push({ label: term, filterType: "search", value: term });
  }

  const riskLabels = { restricted: "Restricted", preview: "Limited / Preview", available: "Available" };
  if (elements.riskFilter.value !== "all") {
    chips.push({ label: `Status: ${riskLabels[elements.riskFilter.value] || elements.riskFilter.value}`, filterType: "availability" });
  }

  const planningLabels = { "available-now": "Available now", roadmap: "Preview / rollout", constraints: "Restrictions" };
  if (elements.planningFilter.value !== "all") {
    chips.push({ label: `Horizon: ${planningLabels[elements.planningFilter.value] || elements.planningFilter.value}`, filterType: "planning" });
  }

  if (elements.providerFilter.value !== "all") {
    chips.push({ label: `Provider: ${elements.providerFilter.value}`, filterType: "provider" });
  }

  if (elements.regionFilter.value !== "all") {
    chips.push({ label: `Region: ${elements.regionFilter.value}`, filterType: "region" });
  }

  if (elements.atRiskToggle.checked) {
    chips.push({ label: "Restricted or limited only", filterType: "at-risk" });
  }

  if (chips.length === 0) {
    elements.filterChips.hidden = true;
    elements.filterChips.innerHTML = "";
    return;
  }

  elements.filterChips.hidden = false;
  elements.filterChips.innerHTML = chips
    .map(
      (chip) =>
        `<button class="filter-chip" type="button" data-filter-type="${escapeAttribute(chip.filterType)}"${chip.value ? ` data-filter-value="${escapeAttribute(chip.value)}"` : ""} aria-label="Remove filter: ${escapeAttribute(chip.label)}">${escapeHtml(chip.label)}<span class="filter-chip-remove" aria-hidden="true">&#x00D7;</span></button>`,
    )
    .join("");
}

function handleChipClick(event) {
  const chip = event.target.closest(".filter-chip");
  if (!chip) {
    return;
  }

  const filterType = chip.dataset.filterType;
  const filterValue = chip.dataset.filterValue;

  switch (filterType) {
    case "search": {
      const currentTerms = elements.searchInput.value.trim().split(/\s+/).filter(Boolean);
      elements.searchInput.value = currentTerms.filter((t) => t !== filterValue).join(" ");
      break;
    }
    case "availability":
      elements.riskFilter.value = "all";
      break;
    case "planning":
      elements.planningFilter.value = "all";
      break;
    case "provider":
      elements.providerFilter.value = "all";
      break;
    case "region":
      elements.regionFilter.value = "all";
      break;
    case "at-risk":
      elements.atRiskToggle.checked = false;
      break;
    default:
      break;
  }

  applyFilters();
}

function renderEmptyUpdatesTable() {
  elements.updatesMeta.textContent = "No Azure update rows prepared";
  elements.updatesTableBody.innerHTML = '<tr><td colspan="6" class="empty-table">Refresh data to build Azure Updates searches for the products in view.</td></tr>';
}

function renderUpdatesTable(records, rawSearchTerm = "") {
  const updatesRows = records
    .map((record) => ({
      ...record,
      planningSignalLabel: getPlanningSignalLabel(record),
    }))
    .sort((left, right) => {
      return (
        right.severity - left.severity ||
        getSourceProductName(left).localeCompare(getSourceProductName(right)) ||
        getRegionDisplayName(left.region).localeCompare(getRegionDisplayName(right.region))
      );
    })
    .slice(0, 12);

  elements.updatesMeta.textContent = updatesRows.length
    ? `${updatesRows.length} Azure Updates searches ready`
    : state.allRecords.length
      ? "No Azure Updates rows match the current filters"
      : "No Azure update rows prepared";

  if (updatesRows.length === 0) {
    elements.updatesTableBody.innerHTML = `<tr><td colspan="6" class="empty-table">${state.allRecords.length ? "Adjust the filters to broaden the update planning view." : "Refresh data to build Azure Updates searches for the products in view."}</td></tr>`;
    return;
  }

  elements.updatesTableBody.innerHTML = updatesRows
    .map(
      (record) => `
        <tr class="${rawSearchTerm ? "search-match-row" : ""}">
          <td><span class="risk-pill ${record.availability}">${escapeHtml(record.planningSignalLabel)}</span></td>
          <td>${renderHighlightedText(getSourceProductName(record), rawSearchTerm)}</td>
          <td>
            <div class="search-term-cell">
              <span class="search-term-chip">${renderHighlightedText(getUpdatesSearchTerm(record), rawSearchTerm)}</span>
              <span class="search-term-note">Paste-ready term for Azure Updates</span>
            </div>
          </td>
          <td>${renderHighlightedText(getRegionDisplayName(record.region), rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.notes || "", rawSearchTerm)}</td>
          <td>
            <div class="source-actions">
              <a class="source-link" href="${escapeAttribute(getUpdatesUrl(record))}" target="_blank" rel="noreferrer" title="${escapeAttribute(getUpdatesTitle(record))}">Open Azure updates</a>
              <button
                class="source-copy-button"
                type="button"
                data-copy-text="${escapeAttribute(getUpdatesUrl(record))}"
                data-copy-label="Azure Updates URL"
                data-copy-success="Copied Azure Updates link for ${escapeAttribute(record.name)}."
                data-copy-failure="Failed to copy the link."
                data-default-content="📋"
                data-copied-content="✓"
                aria-label="Copy Azure Updates URL"
                title="Copy Azure Updates search URL for this product"
              >
                📋
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderTable(records, rawSearchTerm = "") {
  const sortedRecords = sortRecords(records, state.sort);
  const sortLabel = getSortLabel(state.sort);

  elements.tableMeta.textContent = sortedRecords.length
    ? `${sortedRecords.length} rows shown · Sorted by ${sortLabel}`
    : state.allRecords.length
      ? "No rows match the current filters"
      : "No availability data loaded";

  updateSortHeaders();

  if (sortedRecords.length === 0) {
    elements.tableBody.innerHTML = `<tr><td colspan="${getTableColumnCount()}" class="empty-table">${state.allRecords.length ? "Adjust the filters to broaden the view." : "Refresh data or load the overview view to populate the dashboard."}</td></tr>`;
    return;
  }

  elements.tableBody.innerHTML = sortedRecords
    .map(
      (record) => `
        <tr class="${rawSearchTerm ? "search-match-row" : ""}">
          <td><span class="risk-pill ${record.availability}">${capitalize(record.availability)}</span></td>
          <td>${renderHighlightedText(record.providerLabel, rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.name, rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.resourceType, rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.region, rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.metricLabel, rawSearchTerm)}</td>
          <td>${renderHighlightedText(formatMetricValue(record.metricValue, record.unit), rawSearchTerm)}</td>
          <td>${renderHighlightedText(record.notes || "", rawSearchTerm)}</td>
          <td>${renderSourceActions(record)}</td>
        </tr>
      `,
    )
    .join("");
}

function handleTableSortClick(event) {
  const sortButton = event.target.closest("[data-sort-key]");
  if (!sortButton) {
    return;
  }

  const nextKey = sortButton.dataset.sortKey;
  if (!nextKey) {
    return;
  }

  const isSameKey = state.sort.key === nextKey;
  const nextDirection = isSameKey
    ? state.sort.direction === "asc"
      ? "desc"
      : "asc"
    : getDefaultSortDirection(nextKey);

  state.sort = {
    key: nextKey,
    direction: nextDirection,
  };

  renderTable(state.filteredRecords, elements.searchInput.value.trim());
}

function renderSourceActions(record) {
  return `
    <div class="source-actions">
      <a class="source-link" href="${escapeAttribute(record.sourceUrl)}" target="_blank" rel="noreferrer" title="${escapeAttribute(record.sourceTitle)}">By region</a>
      <button
        class="source-copy-button"
        type="button"
        data-copy-text="${escapeAttribute(record.sourceUrl)}"
        data-copy-label="Products by Region URL"
        data-copy-success="Copied Products by Region link."
        data-copy-failure="Failed to copy the link."
        data-default-content="📋"
        data-copied-content="✓"
        aria-label="Copy Products by Region URL"
        title="Copy link to the Microsoft Products by Region table"
      >
        📋
      </button>
    </div>
  `;
}

async function handleSourceActionClick(event) {
  const copyButton = event.target.closest("[data-copy-text]");
  if (!copyButton) {
    return;
  }

  const copyText = copyButton.getAttribute("data-copy-text");
  const label = copyButton.getAttribute("data-copy-label") || "row";
  const successMessage = copyButton.getAttribute("data-copy-success") || `Copied source details for ${label}.`;
  const failureMessage = copyButton.getAttribute("data-copy-failure") || "Failed to copy source details.";
  if (!copyText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(copyText);
    setStatus(successMessage, "good");
    flashCopiedState(copyButton);
  } catch {
    setStatus(failureMessage, "warn");
  }
}

function flashCopiedState(button) {
  const originalContent = button.innerHTML;
  const copiedContent = button.getAttribute("data-copied-content") || "Copied";
  button.innerHTML = copiedContent;
  button.disabled = true;

  window.setTimeout(() => {
    button.innerHTML = button.getAttribute("data-default-content") || originalContent;
    button.disabled = false;
  }, 1200);
}

function updateSortHeaders() {
  const sortButtons = elements.tableHead.querySelectorAll("[data-sort-key]");

  for (const button of sortButtons) {
    const key = button.dataset.sortKey;
    const header = button.closest("th");
    const indicator = button.querySelector(".sort-indicator");
    const isActive = key === state.sort.key;

    button.classList.toggle("is-active", isActive);

    if (header) {
      header.setAttribute(
        "aria-sort",
        isActive ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none",
      );
    }

    if (indicator) {
      indicator.dataset.sortDirection = isActive ? state.sort.direction : "none";
    }
  }
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
  return 9;
}

function getDefaultSortDirection(key) {
  return key === "availability" ? "desc" : "asc";
}

function getSortLabel(sort) {
  const labels = {
    availability: "Status",
    providerLabel: "Provider",
    name: "Offer",
    resourceType: "Resource Type",
    subscriptionId: "Azure Scope",
    region: "Region",
    metricLabel: "Metric",
    metricValue: "Value",
    notes: "Notes",
    source: "Source",
  };

  const directionLabel = sort.direction === "asc" ? "ascending" : "descending";
  return `${labels[sort.key] || sort.key} (${directionLabel})`;
}

function sortRecords(records, sort) {
  return [...records].sort((left, right) => compareRecords(left, right, sort));
}

function compareRecords(left, right, sort) {
  const directionMultiplier = sort.direction === "asc" ? 1 : -1;
  const leftValue = getSortValue(left, sort.key);
  const rightValue = getSortValue(right, sort.key);

  let comparison = 0;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    comparison = leftValue - rightValue;
  } else {
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  if (comparison !== 0) {
    return comparison * directionMultiplier;
  }

  return sortAvailabilityRecords(left, right);
}

function getSortValue(record, key) {
  switch (key) {
    case "availability":
      return record.severity;
    case "region":
      return getRegionDisplayName(record.region);
    case "metricValue":
      return typeof record.metricValue === "number"
        ? record.metricValue
        : formatMetricValue(record.metricValue, record.unit);
    case "notes":
      return record.notes || "";
    case "source":
      return `${getSourceProductName(record)} ${getRegionDisplayName(record.region)}`;
    default:
      return record[key] ?? "";
  }
}

function getSourceUrl(record) {
  return "https://azure.microsoft.com/en-us/explore/global-infrastructure/products-by-region/table";
}

function getSourceLabel(record) {
  return "Public source";
}

function getSourceTitle(record) {
  return `Open the live Microsoft Products by Region table to verify ${getSourceProductName(record)}. This app cannot fill the external search box automatically, so use the copied product term plus the provided geography and region context.`;
}

function getUpdatesUrl(record) {
  const url = new URL("https://azure.microsoft.com/en-us/updates/");
  url.searchParams.set("searchterms", getUpdatesSearchTerm(record));
  return url.toString();
}

function getUpdatesSearchTerm(record) {
  return getSourceProductName(record);
}

function getUpdatesTitle(record) {
  return `Open Azure Updates for ${getSourceProductName(record)} announcements, preview notices, and rollout notes.`;
}

function getSourceContext(record) {
  return `Paste into Microsoft table search: ${getSourceProductName(record)} · Geography ${getGeographyName(record.region) || "All geographies"} · Region ${getRegionDisplayName(record.region)}`;
}

function buildVerificationNote(record) {
  const productName = getSourceProductName(record);
  const geographyName = getGeographyName(record.region) || "All geographies";
  const regionName = getRegionDisplayName(record.region);

  return [
    `Verify dashboard row`,
    `Product: ${productName}`,
    `Geography: ${geographyName}`,
    `Region: ${regionName}`,
    `Offer: ${record.name}`,
    `Planning signal: ${getPlanningSignalLabel(record)}`,
    record.notes ? `Published signal: ${record.notes}` : "",
    `Products by region: ${getSourceUrl(record)}`,
    `Azure updates: ${getUpdatesUrl(record)}`,
    `Suggested check: open Products by Region, search for the product, choose the geography, then confirm the region. Use Azure Updates to validate preview, rollout, or future capability context.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getPlanningSignalLabel(record) {
  if (record.availability === "preview") {
    return "Preview or staged rollout";
  }
  if (record.availability === "restricted") {
    return "Restricted or access-limited";
  }
  return "Currently available";
}

function getSourceProductName(record) {
  const providerProductNames = {
    "compute-skus": "Azure Virtual Machines",
    "sql-capabilities": "Azure SQL",
    "cognitive-skus": record.name.includes("OpenAI") ? "Azure OpenAI" : "Azure AI Services",
    "web-metadata": "Azure App Service",
    "network-metadata": "Azure Networking",
    "storage-metadata": "Azure Storage",
    "aks-metadata": "Azure Kubernetes Service",
    "postgres-metadata": "Azure Database for PostgreSQL",
    "mysql-metadata": "Azure Database for MySQL",
    "cosmos-metadata": "Azure Cosmos DB",
    "cache-metadata": "Azure Cache for Redis",
    "search-metadata": "Azure AI Search",
    "eventhub-metadata": "Azure Event Hubs",
    "servicebus-metadata": "Azure Service Bus",
    "keyvault-metadata": "Azure Key Vault",
    "app-metadata": "Azure Container Apps",
    "signalr-metadata": "Azure SignalR Service",
    "ml-metadata": "Azure Machine Learning",
    "databricks-metadata": "Azure Databricks",
  };

  return providerProductNames[record.providerId] || record.providerLabel;
}

function getRegionDisplayName(region) {
  const metadata = REGION_METADATA[region];
  if (metadata?.displayName) {
    return metadata.displayName;
  }

  return region
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([a-z])(us|uk|uae)$/i, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/(?=[A-Z])|\s+/)
    .join(" ")
    .replace(/\bUs\b/g, "US")
    .replace(/\bUk\b/g, "UK")
    .replace(/\bUae\b/g, "UAE")
    .replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase())
    .trim();
}

function getGeographyName(region) {
  return REGION_METADATA[region]?.geography || "";
}

const REGION_METADATA = {
  eastus: { displayName: "East US", geography: "United States" },
  eastus2: { displayName: "East US 2", geography: "United States" },
  eastus3: { displayName: "East US 3", geography: "United States" },
  centralus: { displayName: "Central US", geography: "United States" },
  northcentralus: { displayName: "North Central US", geography: "United States" },
  southcentralus: { displayName: "South Central US", geography: "United States" },
  westcentralus: { displayName: "West Central US", geography: "United States" },
  westus: { displayName: "West US", geography: "United States" },
  westus2: { displayName: "West US 2", geography: "United States" },
  westus3: { displayName: "West US 3", geography: "United States" },
  canadacentral: { displayName: "Canada Central", geography: "Canada" },
  canadaeast: { displayName: "Canada East", geography: "Canada" },
  brazilsouth: { displayName: "Brazil South", geography: "Brazil" },
  brazilsoutheast: { displayName: "Brazil Southeast", geography: "Brazil" },
  mexicocentral: { displayName: "Mexico Central", geography: "Mexico" },
  chilenorthcentral: { displayName: "Chile North Central", geography: "Chile" },
  northeurope: { displayName: "North Europe", geography: "Europe" },
  westeurope: { displayName: "West Europe", geography: "Europe" },
  francecentral: { displayName: "France Central", geography: "France" },
  francesouth: { displayName: "France South", geography: "France" },
  germanynorth: { displayName: "Germany North", geography: "Germany" },
  germanywestcentral: { displayName: "Germany West Central", geography: "Germany" },
  italynorth: { displayName: "Italy North", geography: "Italy" },
  polandcentral: { displayName: "Poland Central", geography: "Poland" },
  spaincentral: { displayName: "Spain Central", geography: "Spain" },
  swedencentral: { displayName: "Sweden Central", geography: "Sweden" },
  swedensouth: { displayName: "Sweden South", geography: "Sweden" },
  switzerlandnorth: { displayName: "Switzerland North", geography: "Switzerland" },
  switzerlandwest: { displayName: "Switzerland West", geography: "Switzerland" },
  uksouth: { displayName: "UK South", geography: "United Kingdom" },
  ukwest: { displayName: "UK West", geography: "United Kingdom" },
  norwayeast: { displayName: "Norway East", geography: "Norway" },
  norwaywest: { displayName: "Norway West", geography: "Norway" },
  austriaeast: { displayName: "Austria East", geography: "Austria" },
  belgiumcentral: { displayName: "Belgium Central", geography: "Belgium" },
  denmarkeast: { displayName: "Denmark East", geography: "Denmark" },
  finlandcentral: { displayName: "Finland Central", geography: "Finland" },
  greece: { displayName: "Greece", geography: "Greece" },
  southafricanorth: { displayName: "South Africa North", geography: "Africa" },
  southafricawest: { displayName: "South Africa West", geography: "Africa" },
  qatarcentral: { displayName: "Qatar Central", geography: "Qatar" },
  uaecentral: { displayName: "UAE Central", geography: "United Arab Emirates" },
  uaenorth: { displayName: "UAE North", geography: "United Arab Emirates" },
  saudiarabiaeast: { displayName: "Saudi Arabia East", geography: "Saudi Arabia" },
  israelcentral: { displayName: "Israel Central", geography: "Israel" },
  eastasia: { displayName: "East Asia", geography: "Asia Pacific" },
  southeastasia: { displayName: "Southeast Asia", geography: "Asia Pacific" },
  australiacentral: { displayName: "Australia Central", geography: "Australia" },
  australiacentral2: { displayName: "Australia Central 2", geography: "Australia" },
  australiaeast: { displayName: "Australia East", geography: "Australia" },
  australiasoutheast: { displayName: "Australia Southeast", geography: "Australia" },
  chinaeast: { displayName: "China East", geography: "China (operated by 21Vianet)" },
  chinaeast2: { displayName: "China East 2", geography: "China (operated by 21Vianet)" },
  chinanorth: { displayName: "China North", geography: "China (operated by 21Vianet)" },
  chinanorth2: { displayName: "China North 2", geography: "China (operated by 21Vianet)" },
  chinanorth3: { displayName: "China North 3", geography: "China (operated by 21Vianet)" },
  centralindia: { displayName: "Central India", geography: "India" },
  southindia: { displayName: "South India", geography: "India" },
  westindia: { displayName: "West India", geography: "India" },
  japaneast: { displayName: "Japan East", geography: "Japan" },
  japanwest: { displayName: "Japan West", geography: "Japan" },
  koreacentral: { displayName: "Korea Central", geography: "Korea" },
  koreasouth: { displayName: "Korea South", geography: "Korea" },
  indonesiacentral: { displayName: "Indonesia Central", geography: "Indonesia" },
  malaysiawest: { displayName: "Malaysia West", geography: "Malaysia" },
  newzealandnorth: { displayName: "New Zealand North", geography: "New Zealand" },
  taiwan: { displayName: "Taiwan", geography: "Taiwan" },
  usgovarizona: { displayName: "US Gov Arizona", geography: "Azure Government" },
  usgovtexas: { displayName: "US Gov Texas", geography: "Azure Government" },
  usgovvirginia: { displayName: "US Gov Virginia", geography: "Azure Government" },
  usdodcentral: { displayName: "US DoD Central", geography: "Azure Government" },
  usdodeast: { displayName: "US DoD East", geography: "Azure Government" },
  usseceast: { displayName: "US Sec East", geography: "Azure Government" },
  ussecwest: { displayName: "US Sec West", geography: "Azure Government" },
  ussecwestcentral: { displayName: "US Sec West Central", geography: "Azure Government" },
};

bootstrap().catch((error) => {
  console.error(error);
  setStatus(error.message || "Failed to initialize the dashboard.", "bad");
});

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

function matchesSearch(record, rawQuery) {
  const normalizedQuery = normalizeSearchValue(rawQuery);
  if (!normalizedQuery) {
    return true;
  }

  if (record.searchIndex.includes(rawQuery) || record.searchNeedle.includes(normalizedQuery)) {
    return true;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (!queryTokens.length) {
    return true;
  }

  if (queryTokens.every((token) => record.searchNeedle.includes(token))) {
    return true;
  }

  return queryTokens.every((token) => isSubsequence(token, record.searchCompact));
}

function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, "");
}

function isSubsequence(needle, haystack) {
  if (!needle) {
    return true;
  }

  let needleIndex = 0;
  for (const char of haystack) {
    if (char === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }

  return false;
}

function renderHighlightedText(value, rawQuery) {
  const text = String(value || "");
  if (!text) {
    return "";
  }

  const terms = getHighlightTerms(rawQuery);
  if (!terms.length) {
    return escapeHtml(text);
  }

  const directRanges = mergeRanges(collectDirectMatchRanges(text, terms));
  if (directRanges.length > 0) {
    return renderHighlightedRanges(text, directRanges);
  }

  const compactQuery = compactSearchValue(rawQuery);
  if (compactQuery.length < 3) {
    return escapeHtml(text);
  }

  const subsequenceRanges = collectSubsequenceRanges(text, compactQuery);
  return subsequenceRanges.length > 0 ? renderHighlightedRanges(text, subsequenceRanges) : escapeHtml(text);
}

function getHighlightTerms(rawQuery) {
  return normalizeSearchValue(rawQuery)
    .split(" ")
    .filter((term) => term.length > 1);
}

function collectDirectMatchRanges(text, terms) {
  const lowerText = text.toLowerCase();
  const ranges = [];

  for (const term of terms) {
    let startIndex = 0;
    while (startIndex < lowerText.length) {
      const matchIndex = lowerText.indexOf(term, startIndex);
      if (matchIndex === -1) {
        break;
      }

      ranges.push([matchIndex, matchIndex + term.length]);
      startIndex = matchIndex + term.length;
    }
  }

  return ranges;
}

function collectSubsequenceRanges(text, compactQuery) {
  const compactText = compactSearchValue(text);
  if (!compactQuery || !isSubsequence(compactQuery, compactText)) {
    return [];
  }

  const ranges = [];
  let queryIndex = 0;

  for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
    const normalizedChar = normalizeSearchValue(text[textIndex]);
    if (!normalizedChar) {
      continue;
    }

    if (normalizedChar === compactQuery[queryIndex]) {
      ranges.push([textIndex, textIndex + 1]);
      queryIndex += 1;
      if (queryIndex === compactQuery.length) {
        break;
      }
    }
  }

  return mergeRanges(ranges);
}

function mergeRanges(ranges) {
  if (!ranges.length) {
    return [];
  }

  const sortedRanges = [...ranges].sort((left, right) => left[0] - right[0]);
  const mergedRanges = [sortedRanges[0].slice()];

  for (const [start, end] of sortedRanges.slice(1)) {
    const currentRange = mergedRanges[mergedRanges.length - 1];
    if (start <= currentRange[1]) {
      currentRange[1] = Math.max(currentRange[1], end);
      continue;
    }

    mergedRanges.push([start, end]);
  }

  return mergedRanges;
}

function renderHighlightedRanges(text, ranges) {
  let cursor = 0;
  let html = "";

  for (const [start, end] of ranges) {
    html += escapeHtml(text.slice(cursor, start));
    html += `<mark class="search-highlight">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
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

function escapeAttribute(value) {
  return escapeHtml(value);
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